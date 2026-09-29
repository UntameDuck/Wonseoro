// T-M4-22 로컬 축소 검증 — 실제 접수 흐름이 업무 KPI 지표·규칙으로 보이는가
//
// 전제: kind-univ-a 에 업무 KPI 가 들어간 admission-api 가 떠 있고(:18081), observability 네임스페이스의
// Prometheus 에 deploy/platform/observability/kpi-rules.yaml 이 적용돼 있다. 로컬 DB(:5432)에 지원자를 넣는다.
//
//   node tests/m4/business-kpi-kind.mjs
//
// 원서 N건에 대해: 생성 → 자동저장(정상) → 같은 ETag 로 다시 저장(If-Match 충돌) → 모르는 필드 저장(업무 거절)
//   → 결제 의도 → 결제 재검증(Mock PG 확인 → 자동 접수) → 화면 제출(이미 접수됨 = 재시도)
// 그 뒤 Prometheus 에서 결과별 카운터 증가분과 KPI 규칙 값을 읽는다. 수치는 축소 환경 기능 확인이지 성능 수치가 아니다.
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const API = 'http://localhost:18081';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: 'KPI 시험 고등학교', graduationYear: 2026, selfIntro: '업무 KPI 지표 확인용 원서입니다.' };
const N = 5;
const PROM = '/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query';

const result = {
  test: 'T-M4-22',
  scenario: '실제 접수 흐름 → 업무 KPI 카운터·게이지·recording rule',
  environment: 'local-kind-univ-a (축소 환경)',
  limitations: [
    '원서 5건의 기능 확인이다. 비율 수치는 성능·품질 지표가 아니다.',
    'Mock PG 를 쓴다. 실 PG 지연·실패 분포는 T-M4-34·K-PaaS 시험의 몫이다.',
  ],
  startedAt: new Date().toISOString(),
  flows: [],
  checks: {},
};

const sql = (statement) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', 'univ_a', '-qAt',
  '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`], { encoding: 'utf8' }).trim();

async function http(method, path, { headers = {}, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
  return { status: response.status, json, etag: response.headers.get('etag') };
}

async function prom(query) {
  const { stdout } = await exec('kubectl', ['--context', 'kind-univ-a', 'get', '--raw', `${PROM}?query=${encodeURIComponent(query)}`]);
  return JSON.parse(stdout).data.result;
}

function check(name, pass, detail = {}) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

// 누적 합계의 전후 차이로 잰다 — 시험 중에 처음 생긴 카운터 시계열은 increase() 가 첫 표본을 놓친다
const byOutcome = async (metric, extra = '') => Object.fromEntries((await prom(
  `sum by (outcome${extra}) (${metric})`,
)).map((s) => [extra ? `${s.metric.outcome}/${s.metric.trigger}` : s.metric.outcome, Math.round(Number(s.value[1]))]));

const before = {
  draft: await byOutcome('draft_saves_total'),
  payment: await byOutcome('payment_verifications_total'),
  finalize: await byOutcome('finalizations_total', ', trigger'),
};

for (let i = 0; i < N; i += 1) {
  const applicantId = randomUUID();
  const subjectToken = `subj-kpi-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const id = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const key = (step) => ({ 'idempotency-key': `kpi-${step}-${randomUUID()}` });
  const patch = (etag, body) => http('PATCH', `/api/v1/applications/${applicationId}`, {
    headers: { ...id, ...key('save'), 'if-match': etag, 'content-type': 'application/merge-patch+json' }, body,
  });

  const created = await http('POST', '/api/v1/applications', { headers: { ...id, ...key('create') },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } });
  const applicationId = created.json?.id;
  const fresh = await http('GET', `/api/v1/applications/${applicationId}`, { headers: id });
  const saved = await patch(fresh.etag, { fields: FIELDS });
  const stale = await patch(fresh.etag, { fields: FIELDS });                    // 같은 ETag 재사용 → 412
  const unknown = await patch(saved.etag, { fields: { notInSchema: 'x' } });   // 모르는 필드 → 400
  const intent = await http('POST', `/api/v1/applications/${applicationId}/payment-intents`, { headers: { ...id, ...key('intent') } });
  const verified = await http('POST', `/api/v1/payments/${intent.json?.paymentId}/verify`, { headers: { ...id, ...key('verify') } });
  const again = await http('POST', `/api/v1/applications/${applicationId}/finalize`, { headers: { ...id, ...key('finalize') } });
  const flow = { create: created.status, save: saved.status, staleSave: stale.status, unknownField: unknown.status,
    intent: intent.status, verify: verified.status, paymentStatus: verified.json?.status, finalizeAgain: again.status };
  result.flows.push(flow);
  console.log(`· flow ${i + 1} ${JSON.stringify(flow)}`);
}

check('접수 흐름 응답', result.flows.every((f) => f.create === 201 && f.save === 200 && f.staleSave === 412
  && f.unknownField === 400 && f.intent === 201 && f.verify === 200 && f.paymentStatus === 'CONFIRMED' && f.finalizeAgain === 200),
{ flows: result.flows.length });

// 스크레이프(1분)와 규칙 평가(30초)를 기다린다
await new Promise((r) => setTimeout(r, 150_000));

const delta = (after, prev) => Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (prev[k] ?? 0)]));
const draft = delta(await byOutcome('draft_saves_total'), before.draft);
const payment = delta(await byOutcome('payment_verifications_total'), before.payment);
const finalize = delta(await byOutcome('finalizations_total', ', trigger'), before.finalize);
check('draft_saves: saved·conflict·rejected 가 흐름대로 늘었다',
  draft.saved >= N && draft.conflict >= N && draft.rejected >= N && !(draft.error > 0), draft);
check('payment_verifications: verified 가 늘고 error 는 없다', payment.verified >= N && !(payment.error > 0), payment);
check('finalizations: 자동 접수 finalized, 화면 재제출 already_finalized',
  finalize['finalized/payment_confirmed'] >= N && finalize['already_finalized/applicant'] >= N && !(finalize['error/applicant'] > 0), finalize);

const rule = async (name) => { const r = await prom(name); return r.length ? Number(r[0].value[1]) : null; };
const kpi = {};
for (const name of ['kadmission:draft_save_success_rate:5m', 'kadmission:payment_verify_success_rate:5m',
  'kadmission:finalize_success_rate:5m', 'kadmission:finalize_retry_rate:5m', 'kadmission:outbox_oldest_age_seconds',
  'kadmission:central_sync_lag_seconds', 'kadmission:document_scan_pending', 'kadmission:payment_verify_latency_p95_seconds:5m',
  'kadmission:outbox_backlog', 'kadmission:db_lock_waiting_sessions', 'kadmission:http_error_rate:5m',
  'kadmission:http_requests_per_second:2m', 'kadmission:finalize_tps:2m', 'kadmission:http_request_duration_p95_seconds:5m']) {
  kpi[name] = await rule(name);
}
result.kpi = kpi;
check('성공률 3종이 1 (업무 거절·충돌은 분모에서 빠진다)', kpi['kadmission:draft_save_success_rate:5m'] === 1
  && kpi['kadmission:payment_verify_success_rate:5m'] === 1 && kpi['kadmission:finalize_success_rate:5m'] === 1,
{ draft: kpi['kadmission:draft_save_success_rate:5m'], payment: kpi['kadmission:payment_verify_success_rate:5m'], finalize: kpi['kadmission:finalize_success_rate:5m'] });
check('KPI 규칙 14개 모두 값이 있다', Object.values(kpi).every((v) => v !== null && Number.isFinite(v)),
  { missing: Object.entries(kpi).filter(([, v]) => v === null).map(([k]) => k) });

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/business-kpi-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
