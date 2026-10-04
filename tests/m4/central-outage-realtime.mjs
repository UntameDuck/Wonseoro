// T-M4-35 실제 시간 판 — 중앙이 2시간 끊긴 동안 대학 접수가 계속되고, 복구 뒤 event loss 0 인가
//
// central-outage.mjs 는 8.8초로 압축한 기능 확인이다. 이 시험은 §E 인수시험의 **2시간을 실제로** 끊는다.
// 중앙 컨테이너(ka-central)를 멈춘 채로 일정 간격마다 원서를 끝까지 접수하고(결제 확인 → 자동 접수),
// 네 번에 한 번은 접수 전 취소를 섞는다. 1분마다 운영 모드·Outbox·재시도 횟수·Pod 재시작을 표본으로 남긴다.
// 복구 뒤에는 쌓인 이벤트가 전부 SENT 가 되고 중앙이 모두 받았는지, "내 원서" 에 보이는지 확인한다.
//
//   node tests/m4/central-outage-realtime.mjs                 # 120분
//   node tests/m4/central-outage-realtime.mjs --minutes=3 --every=30   # 짧은 사전 점검
//
// 전제: kind-univ-a(:18081)·ka-central(:3000)·로컬 DB 컨테이너. B 대학 Relay 도 같은 중앙을 보므로 함께 끊긴다.
// 결과는 로컬 축소 환경의 기능·내구성 확인이다 — 부하 수치가 아니다.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const OUTAGE_MINUTES = arg('minutes', 120);
const SUBMIT_EVERY_S = arg('every', 300);
const SAMPLE_EVERY_S = arg('sample', 60);
const DRAIN_TIMEOUT_MS = 15 * 60_000;

const API = 'http://localhost:18081';
const CENTRAL = 'http://localhost:3000';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const CENTRAL_DB = 'wonseoro-dev-postgres-central-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = {
  highSchool: '중앙 단절 실제 시간 시험 고등학교',
  graduationYear: 2026,
  academicNote: '중앙이 끊긴 동안 대학 접수가 이어지는지 확인하는 원서입니다.',
};
const FINALIZED = 'kr.kadmission.application.finalized.v1';
const CANCELLED = 'kr.kadmission.application.cancelled.v1';

const startedAt = new Date().toISOString();
const output = `tests/m4/results/central-outage-realtime-${startedAt.replace(/[:.]/g, '-')}.json`;
const result = {
  test: 'T-M4-35',
  scenario: `중앙 ${OUTAGE_MINUTES}분 단절 (실제 시간)`,
  environment: 'local-kind-univ-a + central-container (축소 환경)',
  parameters: { outageMinutes: OUTAGE_MINUTES, submitEverySeconds: SUBMIT_EVERY_S, sampleEverySeconds: SAMPLE_EVERY_S },
  limitations: [
    '원서 수는 몇십 건이다. 단절 중 적체 용량(§B7)이나 복구 직후 폭주 부하는 K-PaaS 시험의 몫이다.',
    '중앙 프로세스를 멈춘 단절이다(연결 거부). 패킷이 사라지는 네트워크 단절(시간 초과)은 다루지 않는다.',
  ],
  startedAt,
  flows: [],
  samples: [],
  checks: {},
};

const save = () => {
  mkdirSync('tests/m4/results', { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
};

async function http(base, method, path, { headers = {}, body, timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON 아닌 오류 응답 */ }
    return { status: response.status, json, headers: response.headers, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, error: error.name === 'AbortError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const psql = (container, db, schema, statement) => execFileSync(
  'docker',
  ['exec', '-i', container, 'psql', '-U', 'wonseoro', '-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${schema},public; ${statement}`],
  { encoding: 'utf8' },
).trim();
const universitySql = (s) => psql(DB, 'univ_a', 'kadmission', s);
const centralSql = (s) => psql(CENTRAL_DB, 'central', 'kadmission_central', s);

function check(name, pass, detail = {}) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady(base, up, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await http(base, 'GET', '/readyz', { timeoutMs: 2500 });
    if (up ? response.status === 200 : response.status === 0) return Date.now() - started;
    await sleep(500);
  }
  throw new Error(`ready state did not become ${up ? 'up' : 'down'}: ${base}`);
}

function restarts() {
  const pods = JSON.parse(execFileSync('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'get', 'pods', '-o', 'json'], { encoding: 'utf8' }));
  return Object.fromEntries(pods.items.map((p) => [
    p.metadata.labels?.app ?? p.metadata.name,
    (p.status.containerStatuses ?? []).reduce((n, c) => n + c.restartCount, 0),
  ]).reduce((acc, [app, n]) => { acc.set(app, (acc.get(app) ?? 0) + n); return acc; }, new Map()));
}

async function flow(kind) {
  const applicantId = randomUUID();
  const subjectToken = `subj-m4-35rt-${applicantId.slice(0, 8)}`;
  universitySql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const identity = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const steps = {};
  const record = { kind, at: new Date().toISOString(), subjectToken, steps };
  const created = await http(API, 'POST', '/api/v1/applications', {
    headers: { ...identity, 'idempotency-key': `m4-35rt-create-${randomUUID()}` },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT },
  });
  steps.create = { status: created.status, ms: created.ms };
  if (created.status !== 201) return { ...record, ok: false };
  record.applicationId = created.json.id;
  const saved = await http(API, 'PATCH', `/api/v1/applications/${record.applicationId}`, {
    headers: {
      ...identity,
      'idempotency-key': `m4-35rt-save-${randomUUID()}`,
      'if-match': created.headers.get('etag'),
      'content-type': 'application/merge-patch+json',
    },
    body: { fields: FIELDS },
  });
  steps.save = { status: saved.status, ms: saved.ms };
  if (saved.status !== 200) return { ...record, ok: false };

  if (kind === 'cancel') {
    const cancelled = await http(API, 'POST', `/api/v1/applications/${record.applicationId}/cancel`, {
      headers: { ...identity, 'idempotency-key': `m4-35rt-cancel-${randomUUID()}` },
      body: { reason: '중앙 단절 시험 취소' },
    });
    steps.cancel = { status: cancelled.status, ms: cancelled.ms };
    record.eventType = CANCELLED;
  } else {
    const intent = await http(API, 'POST', `/api/v1/applications/${record.applicationId}/payment-intents`, {
      headers: { ...identity, 'idempotency-key': `m4-35rt-intent-${randomUUID()}` },
    });
    steps.intent = { status: intent.status, ms: intent.ms };
    if (intent.status !== 201) return { ...record, ok: false };
    const verified = await http(API, 'POST', `/api/v1/payments/${intent.json.paymentId}/verify`, {
      headers: { ...identity, 'idempotency-key': `m4-35rt-verify-${randomUUID()}` },
    });
    steps.verify = { status: verified.status, ms: verified.ms };
    const submission = await http(API, 'GET', `/api/v1/applications/${record.applicationId}/submission`, { headers: identity });
    steps.submission = { status: submission.status, ms: submission.ms };
    record.applicationNumber = submission.json?.applicationNumber;
    record.eventType = FINALIZED;
  }
  record.eventId = universitySql(`SELECT id FROM outbox_event WHERE aggregate_id='${record.applicationId}' AND event_type='${record.eventType}' ORDER BY created_at DESC LIMIT 1`);
  record.ok = Object.values(steps).every((s) => s.status >= 200 && s.status < 300) && Boolean(record.eventId);
  return record;
}

const eventIds = () => result.flows.filter((f) => f.eventId).map((f) => `'${f.eventId}'`);

function outboxOfTest() {
  const ids = eventIds();
  if (ids.length === 0) return { byStatus: {}, maxAttempt: 0 };
  const rows = universitySql(`SELECT status, count(*), max(attempt_count) FROM outbox_event WHERE id IN (${ids.join(',')}) GROUP BY status`);
  const byStatus = {};
  let maxAttempt = 0;
  for (const line of rows.split('\n').filter(Boolean)) {
    const [status, count, max] = line.split('|');
    byStatus[status] = Number(count);
    maxAttempt = Math.max(maxAttempt, Number(max));
  }
  return { byStatus, maxAttempt };
}

async function sample(phase) {
  const mode = await http(API, 'GET', '/api/v1/meta/operating-mode', { timeoutMs: 5000 });
  const ready = await http(API, 'GET', '/readyz', { timeoutMs: 5000 });
  const s = {
    at: new Date().toISOString(),
    phase,
    apiReady: ready.status,
    mode: mode.json?.mode ?? `HTTP ${mode.status}`,
    pendingEvents: mode.json?.sync?.pendingEvents,
    oldestPendingAgeSeconds: mode.json?.sync?.oldestPendingAgeSeconds,
    lagging: mode.json?.sync?.lagging,
    testOutbox: outboxOfTest(),
    deadTotal: Number(universitySql(`SELECT count(*) FROM outbox_event WHERE status='DEAD'`)),
  };
  result.samples.push(s);
  console.log(`[${s.at}] ${phase} mode=${s.mode} pending=${s.pendingEvents} oldest=${s.oldestPendingAgeSeconds}s outbox=${JSON.stringify(s.testOutbox)} dead=${s.deadTotal}`);
  save();
  return s;
}

let centralRestored = false;
try {
  await waitReady(API, true, 30_000);
  await waitReady(CENTRAL, true, 30_000);
  const restartsBefore = restarts();
  const deadBefore = Number(universitySql(`SELECT count(*) FROM outbox_event WHERE status='DEAD'`));
  const exceptionsBefore = Number(universitySql('SELECT count(*) FROM reconciliation_exception'));
  result.baseline = { restarts: restartsBefore, deadTotal: deadBefore, reconciliationExceptions: exceptionsBefore };
  await sample('before');

  execFileSync('docker', ['stop', 'ka-central'], { stdio: 'inherit' });
  const downMs = await waitReady(CENTRAL, false, 30_000);
  const outageStart = Date.now();
  const outageEnd = outageStart + OUTAGE_MINUTES * 60_000;
  result.outageStartedAt = new Date(outageStart).toISOString();
  check('central-is-down', true, { detectedMs: downMs });

  let nextSubmit = outageStart;
  let nextSample = outageStart + SAMPLE_EVERY_S * 1000;
  let n = 0;
  while (Date.now() < outageEnd) {
    if (Date.now() >= nextSubmit) {
      const kind = n % 4 === 3 ? 'cancel' : 'finalize';
      const f = await flow(kind);
      result.flows.push(f);
      console.log(`  flow#${n} ${kind} ${f.ok ? 'ok' : 'FAIL'} ${JSON.stringify(f.steps)}`);
      n += 1;
      nextSubmit += SUBMIT_EVERY_S * 1000;
      save();
    }
    if (Date.now() >= nextSample) {
      await sample('outage');
      nextSample += SAMPLE_EVERY_S * 1000;
    }
    await sleep(1000);
  }
  const lastOutage = await sample('outage-end');
  result.outageEndedAt = new Date().toISOString();
  const outageSamples = result.samples.filter((s) => s.phase.startsWith('outage'));

  check('university-submits-throughout-outage', result.flows.length > 0 && result.flows.every((f) => f.ok), {
    flows: result.flows.length,
    failed: result.flows.filter((f) => !f.ok).map((f) => ({ at: f.at, steps: f.steps })),
    finalized: result.flows.filter((f) => f.kind === 'finalize').length,
    cancelled: result.flows.filter((f) => f.kind === 'cancel').length,
  });
  check('autonomous-mode-during-outage', outageSamples.length > 0 && outageSamples.every((s) => s.mode === 'AUTONOMOUS'), {
    modes: [...new Set(outageSamples.map((s) => s.mode))],
    maxOldestPendingAgeSeconds: Math.max(0, ...outageSamples.map((s) => s.oldestPendingAgeSeconds ?? 0)),
  });
  check('no-dead-during-outage', outageSamples.every((s) => !s.testOutbox.byStatus.DEAD) && lastOutage.deadTotal === deadBefore, {
    deadBefore,
    deadAfterOutage: lastOutage.deadTotal,
    maxAttemptCount: Math.max(0, ...outageSamples.map((s) => s.testOutbox.maxAttempt)),
  });
  check('api-ready-throughout-outage', outageSamples.every((s) => s.apiReady === 200), {
    notReady: outageSamples.filter((s) => s.apiReady !== 200).map((s) => s.at),
  });

  execFileSync('docker', ['start', 'ka-central'], { stdio: 'inherit' });
  await waitReady(CENTRAL, true, 90_000);
  centralRestored = true;
  const restoreAt = Date.now();
  result.centralRestoredAt = new Date(restoreAt).toISOString();

  // 쌓인 이벤트가 모두 SENT 가 될 때까지
  let drainedMs = null;
  while (Date.now() - restoreAt < DRAIN_TIMEOUT_MS) {
    const { byStatus } = outboxOfTest();
    if ((byStatus.SENT ?? 0) === eventIds().length) { drainedMs = Date.now() - restoreAt; break; }
    await sleep(2000);
  }
  await sample('after');
  check('outbox-drains-after-restore', drainedMs !== null, { drainedMs, events: eventIds().length });

  const ids = eventIds();
  const received = Number(centralSql(`SELECT count(DISTINCT event_id) FROM received_event WHERE event_id IN (${ids.join(',')})`));
  const sent = Number(universitySql(`SELECT count(*) FROM outbox_event WHERE id IN (${ids.join(',')}) AND status='SENT'`));
  check('event-loss-is-zero', sent === ids.length && received === ids.length, { expected: ids.length, sent, received });

  // 접수는 중앙 "내 원서" 에 접수번호로 보인다. 취소는 접수 전에만 있고(D-7) 접수 전 원서는 중앙 화면에
  // 나오지 않으므로(취소 본문에는 subjectRef 가 없다) 중앙 요약이 CANCELLED 인지로 확인한다.
  const missing = [];
  for (const f of result.flows) {
    if (f.kind === 'cancel') {
      const opaqueId = universitySql(`SELECT payload->>'applicationId' FROM outbox_event WHERE id='${f.eventId}'`);
      const status = centralSql(`SELECT status FROM application_summary WHERE application_id='${opaqueId}'`);
      if (status !== 'CANCELLED') missing.push({ kind: f.kind, at: f.at, centralStatus: status });
      continue;
    }
    const dashboard = await http(CENTRAL, 'GET', '/api/v1/dashboard/applications', { headers: { 'x-subject-token': f.subjectToken } });
    const apps = dashboard.json?.applications ?? [];
    if (!apps.some((a) => a.applicationNumber === f.applicationNumber)) missing.push({ kind: f.kind, at: f.at, status: dashboard.status });
  }
  check('central-reflects-all', missing.length === 0, { checked: result.flows.length, missing });

  // 복구 후 운영 모드가 CONNECTED 로 돌아오는지 (게이트 주기를 기다린다)
  let reconnectedMs = null;
  while (Date.now() - restoreAt < 5 * 60_000) {
    const mode = await http(API, 'GET', '/api/v1/meta/operating-mode', { timeoutMs: 5000 });
    if (mode.json?.mode === 'CONNECTED' && mode.json?.sync?.pendingEvents === 0) { reconnectedMs = Date.now() - restoreAt; break; }
    await sleep(2000);
  }
  check('connected-mode-after-restore', reconnectedMs !== null, { reconnectedMs });

  const restartsAfter = restarts();
  check('no-pod-restarts', JSON.stringify(restartsAfter) === JSON.stringify(restartsBefore), { before: restartsBefore, after: restartsAfter });
  result.reconciliationExceptionsCreated = Number(universitySql('SELECT count(*) FROM reconciliation_exception')) - exceptionsBefore;
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  console.error(`✖ 중단: ${result.error}`);
} finally {
  if (!centralRestored) {
    try {
      execFileSync('docker', ['start', 'ka-central'], { stdio: 'ignore' });
      await waitReady(CENTRAL, true, 90_000);
      centralRestored = true;
    } catch (error) {
      result.restoreError = error instanceof Error ? error.message : String(error);
    }
  }
}

check('central-restored', centralRestored, { restored: centralRestored });
result.finishedAt = new Date().toISOString();
result.passed = !result.error && !result.restoreError && Object.values(result.checks).every((item) => item.pass);
save();
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
