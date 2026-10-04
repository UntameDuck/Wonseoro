// T-M4-35 — 중앙 Sync 단절 중 접수 지속, 복구 후 event loss 0
//
// 운영 인수시험의 2시간 단절을 로컬에서는 짧게 압축한다. 중앙 컨테이너를 정지한 동안
// 대학 원서 2건을 끝까지 접수하고, 중앙 복구 뒤 Outbox가 모두 재전송되어 Dashboard에
// 나타나는지 확인한다. 시간 압축 결과이지 2시간 내구성 실측이 아니다.
//
//   node tests/m4/central-outage.mjs
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const CENTRAL = 'http://localhost:3000';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const DB_NAME = 'univ_a';
const CENTRAL_DB = 'wonseoro-dev-postgres-central-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = {
  highSchool: '중앙 단절 시험 고등학교',
  graduationYear: 2026,
  academicNote: '중앙 단절 중 대학 접수 지속과 Outbox 재전송 시험입니다.',
};

const result = {
  test: 'T-M4-35',
  environment: 'local-kind-univ-a + central-container (축소·시간 압축 환경)',
  productionScenario: '중앙 2시간 단절',
  startedAt: new Date().toISOString(),
  checks: {},
};

async function http(base, method, path, { headers = {}, body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
    return { status: response.status, json, headers: response.headers };
  } catch (error) {
    return { status: 0, error: error.name === 'AbortError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message) };
  } finally {
    clearTimeout(timer);
  }
}

function universitySql(statement) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', DB_NAME, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`],
    { encoding: 'utf8' },
  ).trim();
}

function centralSql(statement) {
  return execFileSync(
    'docker',
    ['exec', '-i', CENTRAL_DB, 'psql', '-U', 'wonseoro', '-d', 'central', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission_central,public; ${statement}`],
    { encoding: 'utf8' },
  ).trim();
}

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

async function waitReady(base, up, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await http(base, 'GET', '/readyz', { timeoutMs: 2500 });
    if (up ? response.status === 200 : response.status === 0) return Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`ready state did not become ${up ? 'up' : 'down'}: ${base}`);
}

async function applyFlow(label) {
  const applicantId = randomUUID();
  const subjectToken = `subj-m4-35-${label}-${applicantId.slice(0, 8)}`;
  universitySql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const identity = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const created = await http(API, 'POST', '/api/v1/applications', {
    headers: { ...identity, 'idempotency-key': `m4-35-create-${randomUUID()}` },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT },
  });
  if (created.status !== 201) return { ok: false, step: 'create', response: created };
  const applicationId = created.json.id;
  const saved = await http(API, 'PATCH', `/api/v1/applications/${applicationId}`, {
    headers: {
      ...identity,
      'idempotency-key': `m4-35-save-${randomUUID()}`,
      'if-match': created.headers.get('etag'),
      'content-type': 'application/merge-patch+json',
    },
    body: { fields: FIELDS },
  });
  if (saved.status !== 200) return { ok: false, step: 'save', response: saved };
  const intent = await http(API, 'POST', `/api/v1/applications/${applicationId}/payment-intents`, {
    headers: { ...identity, 'idempotency-key': `m4-35-intent-${randomUUID()}` },
  });
  if (intent.status !== 201) return { ok: false, step: 'intent', response: intent };
  const verified = await http(API, 'POST', `/api/v1/payments/${intent.json.paymentId}/verify`, {
    headers: { ...identity, 'idempotency-key': `m4-35-verify-${randomUUID()}` },
  });
  const submission = await http(API, 'GET', `/api/v1/applications/${applicationId}/submission`, { headers: identity });
  const eventId = universitySql(`SELECT id FROM outbox_event WHERE aggregate_id='${applicationId}' AND event_type='kr.kadmission.application.finalized.v1' ORDER BY created_at DESC LIMIT 1`);
  return {
    ok: verified.status === 200 && submission.status === 200 && Boolean(eventId),
    applicationId,
    applicationNumber: submission.json?.applicationNumber,
    subjectToken,
    eventId,
  };
}

async function waitSynced(flow, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dashboard = await http(CENTRAL, 'GET', '/api/v1/dashboard/applications', {
      headers: { 'x-subject-token': flow.subjectToken },
    });
    if (dashboard.json?.applications?.some((item) => item.applicationNumber === flow.applicationNumber)) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

let centralRestored = false;
try {
  await waitReady(API, true, 30_000);
  await waitReady(CENTRAL, true, 30_000);

  execFileSync('docker', ['stop', 'ka-central'], { stdio: 'inherit' });
  const downMs = await waitReady(CENTRAL, false, 30_000);
  const outageStarted = Date.now();
  check('central-is-down', true, { detectedMs: downMs });

  const flows = [await applyFlow('one'), await applyFlow('two')];
  check('university-submits-during-central-outage', flows.every((flow) => flow.ok), {
    applications: flows.map((flow) => ({ applicationId: flow.applicationId, applicationNumber: flow.applicationNumber })),
  });

  // 운영 2시간 대신 짧게 유지한다. 이 결과로 2시간 내구성을 주장하지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const pendingDuringOutage = flows.map((flow) => ({
    eventId: flow.eventId,
    status: universitySql(`SELECT status FROM outbox_event WHERE id='${flow.eventId}'`),
  }));
  check('outbox-holds-events-during-outage', pendingDuringOutage.every((item) => item.status !== 'SENT'), {
    events: pendingDuringOutage,
    compressedOutageMs: Date.now() - outageStarted,
  });

  execFileSync('docker', ['start', 'ka-central'], { stdio: 'inherit' });
  await waitReady(CENTRAL, true, 60_000);
  centralRestored = true;

  const seen = [];
  for (const flow of flows) seen.push(await waitSynced(flow));
  check('dashboard-recovers-all-applications', seen.every((value) => value !== null), { seenAfterMs: seen });

  const sentCount = Number(universitySql(`SELECT count(*) FROM outbox_event WHERE id IN (${flows.map((flow) => `'${flow.eventId}'`).join(',')}) AND status='SENT'`));
  const receivedCount = Number(centralSql(`SELECT count(DISTINCT event_id) FROM received_event WHERE event_id IN (${flows.map((flow) => `'${flow.eventId}'`).join(',')})`));
  check('event-loss-is-zero', sentCount === flows.length && receivedCount === flows.length, {
    expected: flows.length,
    sentCount,
    receivedCount,
  });
  result.eventIds = flows.map((flow) => flow.eventId);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
} finally {
  try {
    execFileSync('docker', ['start', 'ka-central'], { stdio: 'ignore' });
    await waitReady(CENTRAL, true, 60_000);
    centralRestored = true;
  } catch (error) {
    result.restoreError = error instanceof Error ? error.message : String(error);
  }
}

check('central-restored', centralRestored, { restored: centralRestored });
result.finishedAt = new Date().toISOString();
result.passed = !result.error && !result.restoreError && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/central-outage-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
