// T-M4-34 실제 시간 판 — PG 가 1~30분 늦게 확정을 알려도 접수가 저절로, 한 번만 끝나는가
//
// payment-recovery.mjs 는 워커 1초·Backoff 를 DB 시각으로 당긴 시간 압축판이다. 이 시험은 시간을 당기지 않는다.
// 지원자는 결제 직후 한 번 확인하고(UNKNOWN) 창을 닫는다. PG(Mock 지연 모드)는 결제마다 1·5·15·30분 동안
// "모른다" 고 답하다가 확정으로 바뀐다. 지연마다 두 건씩 —
//   · callback: 확정되는 순간 PG 콜백이 온다 → 서버가 즉시 재조회해 접수해야 한다
//   · poll    : 콜백이 끝내 오지 않는다 → 결제 재확인 워커(30초 × 2^n, 최대 30분)가 찾아 접수해야 한다
// 확정 뒤 같은 콜백을 다시 보내 중복 처리가 없는지, 기다리는 동안 FAILED·중복 접수가 없는지 본다.
//
// 전제: kind-univ-a API 에 MOCK_PG_CONFIRM_DELAYS_S=60,300,900,1800 이 들어가 있다
//   kubectl --context kind-univ-a -n kadmission-app set env deploy/univ-a-api MOCK_PG_CONFIRM_DELAYS_S=60,300,900,1800
// 끝나면 `MOCK_PG_CONFIRM_DELAYS_S-` 로 되돌린다(이 스크립트는 배포를 바꾸지 않는다).
// 콜백 서명은 로컬 개발 기본 비밀로 만든다 — 로컬 축소 환경 전용이다.
//
//   node tests/m4/pg-delay-realtime.mjs
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: 'PG 지연 실제 시간 시험 고등학교', graduationYear: 2026, selfIntro: 'PG 확정이 늦게 와도 접수가 저절로 끝나는지 봅니다.' };
const DEV_CALLBACK_SECRET = 'dev-pg-callback-secret'; // apps/admission-api/src/config.ts 의 개발 기본값
const DELAYS_S = [60, 300, 900, 1800];
const BACKOFF_CAP_S = 1800;
const WORKER_INTERVAL_S = 30;
const POLL_MS = 5000;
// 시각은 Pod(kind 노드)와 이 PC 의 시계를 섞어 쓴다. 몇 초 어긋나도 판정이 뒤집히지 않게 여유를 둔다.
const CLOCK_SKEW_MS = 3000;

const startedAt = new Date().toISOString();
const output = `tests/m4/results/pg-delay-realtime-${startedAt.replace(/[:.]/g, '-')}.json`;
const result = {
  test: 'T-M4-34',
  scenario: 'PG 확정 1·5·15·30분 지연 — 콜백 경로·폴링 경로 (실제 시간)',
  environment: 'local-kind-univ-a, Mock PG 지연 모드 (축소 환경)',
  limitations: [
    'Mock PG 다. 실 PG 의 조회 응답·콜백 재시도 규칙은 T-M6-04 연동 때 다시 본다.',
    '결제 8건의 기능·시간 확인이다. 마감 피크의 PG 호출량은 K-PaaS 부하 시험의 몫이다.',
  ],
  startedAt,
  payments: [],
  checks: {},
};
const save = () => { mkdirSync('tests/m4/results', { recursive: true }); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); };

const sql = (statement) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', 'univ_a', '-qAt',
  '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, { headers = {}, body, raw } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
  return { status: response.status, json, etag: response.headers.get('etag') };
}

function check(name, pass, detail = {}) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

async function callback(providerTxId, eventId) {
  const raw = JSON.stringify({ providerTxId, eventId });
  const signature = createHmac('sha256', DEV_CALLBACK_SECRET).update(raw).digest('hex');
  const r = await http('POST', '/api/v1/payments/callbacks/mock-pg', { headers: { 'x-pg-signature': signature }, raw });
  return { status: r.status, outcome: r.json?.outcome };
}

async function startPayment() {
  const applicantId = randomUUID();
  const subjectToken = `subj-m4-34rt-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const id = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const created = await http('POST', '/api/v1/applications', { headers: { ...id, 'idempotency-key': `m4-34rt-create-${randomUUID()}` }, body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } });
  if (created.status !== 201) throw new Error(`create ${created.status}`);
  const saved = await http('PATCH', `/api/v1/applications/${created.json.id}`, {
    headers: { ...id, 'idempotency-key': `m4-34rt-save-${randomUUID()}`, 'if-match': created.etag, 'content-type': 'application/merge-patch+json' },
    body: { fields: FIELDS },
  });
  if (saved.status !== 200) throw new Error(`save ${saved.status}`);
  const intent = await http('POST', `/api/v1/applications/${created.json.id}/payment-intents`, { headers: { ...id, 'idempotency-key': `m4-34rt-intent-${randomUUID()}` } });
  if (intent.status !== 201) throw new Error(`intent ${intent.status}`);
  // 지원자는 결제 직후 한 번 확인하고 창을 닫는다.
  const first = await http('POST', `/api/v1/payments/${intent.json.paymentId}/verify`, { headers: { ...id, 'idempotency-key': `m4-34rt-verify-${randomUUID()}` } });
  const providerTxId = sql(`SELECT provider_tx_id FROM payment WHERE id='${intent.json.paymentId}'`);
  const m = /^MOCK-D(\d+)-([0-9A-Z]+)-/.exec(providerTxId);
  if (!m) throw new Error(`API 가 지연 모드가 아니다 (provider_tx_id=${providerTxId}) — MOCK_PG_CONFIRM_DELAYS_S 를 넣었는지 확인`);
  const paidAtMs = parseInt(m[2], 36);
  return {
    applicationId: created.json.id,
    paymentId: intent.json.paymentId,
    providerTxId,
    delayS: Number(m[1]),
    paidAt: new Date(paidAtMs).toISOString(),
    availableAtMs: paidAtMs + Number(m[1]) * 1000,
    firstVerify: { status: first.status, paymentStatus: first.json?.status },
  };
}

function state(p) {
  const [status, verifies, submissions, finalizedAt] = sql(`SELECT p.status,
      (SELECT count(*) FROM payment_event e WHERE e.payment_id=p.id AND e.event_type LIKE 'VERIFY\\_%'),
      (SELECT count(*) FROM submission s WHERE s.application_id=p.application_id),
      (SELECT to_char(min(s.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM submission s WHERE s.application_id=p.application_id)
    FROM payment p WHERE p.id='${p.paymentId}'`).split('|');
  return { status, verifies: Number(verifies), submissions: Number(submissions), finalizedAt: finalizedAt || null };
}

try {
  const ready = await http('GET', '/readyz');
  if (ready.status !== 200) throw new Error(`API not ready (${ready.status})`);
  result.baseline = { reconciliationExceptions: Number(sql('SELECT count(*) FROM reconciliation_exception')) };

  // 지연마다 두 건(콜백·폴링)이 모일 때까지 결제를 만든다. API Pod 가 둘이라 Pod 마다 지연 순번이 따로 돈다.
  const byDelay = new Map(DELAYS_S.map((d) => [d, []]));
  for (let i = 0; i < 16 && [...byDelay.values()].some((list) => list.length < 2); i++) {
    const p = await startPayment();
    const list = byDelay.get(p.delayS);
    if (!list || list.length >= 2) { p.mode = 'extra'; result.payments.push(p); continue; }
    p.mode = list.length === 0 ? 'callback' : 'poll';
    list.push(p);
    result.payments.push(p);
    console.log(`  결제 ${p.paymentId} 지연 ${p.delayS}s ${p.mode} 첫 확인=${JSON.stringify(p.firstVerify)}`);
  }
  save();
  const tracked = result.payments.filter((p) => p.mode !== 'extra');
  check('each-delay-has-callback-and-poll', [...byDelay.values()].every((l) => l.length === 2), {
    delays: Object.fromEntries([...byDelay].map(([d, l]) => [d, l.map((p) => p.mode)])),
  });
  check('first-verify-is-not-failed', tracked.every((p) => p.firstVerify.paymentStatus === 'UNKNOWN'), {
    first: tracked.map((p) => p.firstVerify),
  });

  // 끝날 때까지 지켜본다. 폴링 경로의 상한 = 확정 시각 + Backoff 상한 + 워커 주기 + 여유
  const deadlineMs = Math.max(...tracked.map((p) => p.availableAtMs)) + (BACKOFF_CAP_S + WORKER_INTERVAL_S + 120) * 1000;
  const anomalies = [];
  while (Date.now() < deadlineMs) {
    for (const p of tracked) {
      if (p.done) continue;
      const s = state(p);
      const now = Date.now();
      if (s.status === 'FAILED' || s.submissions > 1) anomalies.push({ paymentId: p.paymentId, at: new Date(now).toISOString(), ...s });
      if (now < p.availableAtMs - CLOCK_SKEW_MS && (s.status === 'CONFIRMED' || s.submissions > 0)) anomalies.push({ paymentId: p.paymentId, early: true, ...s });
      if (p.mode === 'callback' && !p.callback && now >= p.availableAtMs + CLOCK_SKEW_MS) {
        p.callbackEventId = `evt-${randomUUID()}`;
        p.callback = { at: new Date().toISOString(), ...(await callback(p.providerTxId, p.callbackEventId)) };
        console.log(`  콜백 ${p.paymentId} (${p.delayS}s) → ${JSON.stringify(p.callback)}`);
      }
      if (s.submissions >= 1 && s.status === 'CONFIRMED') {
        p.done = true;
        p.final = s;
        p.finalizeLagS = Math.round((Date.parse(s.finalizedAt) - p.availableAtMs) / 100) / 10;
        console.log(`  접수 ${p.paymentId} ${p.mode} 지연 ${p.delayS}s → 확정 후 ${p.finalizeLagS}s, PG 조회 ${s.verifies}회`);
        save();
      }
    }
    if (tracked.every((p) => p.done)) break;
    await sleep(POLL_MS);
  }

  // 확정·접수 뒤 늦은 콜백 — 콜백 경로는 같은 이벤트 재전송, 폴링 경로는 처음 오는 늦은 콜백
  for (const p of tracked.filter((x) => x.done)) {
    p.lateCallback = await callback(p.providerTxId, p.callbackEventId ?? `evt-late-${randomUUID()}`);
    p.afterLate = state(p);
  }
  save();

  check('all-auto-finalized', tracked.every((p) => p.done), {
    notFinalized: tracked.filter((p) => !p.done).map((p) => ({ paymentId: p.paymentId, delayS: p.delayS, mode: p.mode, ...state(p) })),
  });
  check('no-failed-no-early-no-double', anomalies.length === 0, { anomalies });
  check('callback-path-finalizes-within-15s', tracked.filter((p) => p.mode === 'callback').every((p) => p.done && p.finalizeLagS <= 15), {
    lagS: tracked.filter((p) => p.mode === 'callback').map((p) => ({ delayS: p.delayS, lagS: p.finalizeLagS, callback: p.callback })),
  });
  check('poll-path-finalizes-within-backoff-cap', tracked.filter((p) => p.mode === 'poll').every((p) => p.done && p.finalizeLagS <= BACKOFF_CAP_S + WORKER_INTERVAL_S), {
    lagS: tracked.filter((p) => p.mode === 'poll').map((p) => ({ delayS: p.delayS, lagS: p.finalizeLagS, pgQueries: p.final?.verifies })),
  });
  check('late-callback-is-idempotent', tracked.filter((p) => p.done).every((p) => p.lateCallback.status === 200 && p.afterLate.submissions === 1 && p.afterLate.status === 'CONFIRMED'), {
    late: tracked.map((p) => ({ mode: p.mode, delayS: p.delayS, ...p.lateCallback, submissions: p.afterLate?.submissions })),
  });
  check('pg-queries-bounded', tracked.every((p) => (p.final?.verifies ?? 99) <= 10), {
    verifies: tracked.map((p) => ({ mode: p.mode, delayS: p.delayS, verifies: p.final?.verifies })),
  });
  result.reconciliationExceptionsCreated = Number(sql('SELECT count(*) FROM reconciliation_exception')) - result.baseline.reconciliationExceptions;
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  console.error(`✖ 중단: ${result.error}`);
}

result.finishedAt = new Date().toISOString();
result.passed = !result.error && Object.values(result.checks).every((c) => c.pass);
save();
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
