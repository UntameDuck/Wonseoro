// T-M4-40 로컬 축소 검증 — 학교 NAT 뒤 정상 지원자 200명 + 봇 동시 → 정상 사용자 차단 0 (§01 B6, STRIDE D-02)
//
// 전제: kind-univ-a 에 Adaptive Throttling 이 들어간 admission-api(:18081, THROTTLE_MODE=enforce)가 떠 있다.
// 모든 요청이 이 PC 한 곳에서 나간다 — 한 학교가 같은 공인 IP 로 나오는 상황과 같다.
//
//   node tests/m4/nat-bot-kind.mjs [초=90] [no-bots]    # no-bots: 같은 정상 부하만 — 포화가 봇 때문인지 가르는 기준 실행
//
// 정상 지원자: 원서 생성 → 3~5초마다 자동저장, 15초마다 조회 → 마지막에 결제 의도·결제 확인(자동 접수)·화면 제출
// 봇 5개:     탐색 봇 2(남의 원서 ID 를 초당 20번 조회 + 자기 원서 저장 폭주) · 폭주 봇 3(저장 초당 20번 + 원서 생성 초당 2번)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const DURATION_MS = Number(process.argv[2] ?? 90) * 1000;
const NORMAL = 200;
const WITH_BOTS = process.argv[3] !== 'no-bots';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: 'NAT 시험 고등학교', graduationYear: 2026, academicNote: '같은 공인 IP 뒤에서 원서를 쓰는 정상 지원자입니다.' };

const result = {
  test: 'T-M4-40',
  scenario: `학교 NAT(단일 출발지) 뒤 정상 지원자 ${NORMAL}명${WITH_BOTS ? ' + 봇 5개' : ' (봇 없음 — 기준 실행)'} 동시 ${DURATION_MS / 1000}초`,
  environment: 'local-kind-univ-a (축소 환경, API Pod 2개, 한도 상태는 Pod 메모리)',
  limitations: [
    '인증은 dev-headers 다. 운영에서는 게이트웨이가 검증한 지원자 신원이 키가 되므로 봇이 신원을 마음대로 바꿀 수 없다.',
    'CAPTCHA 대체 확인 수단은 아직 없다(인증 연동 M5). 위험 차단은 Retry-After 로 시간이 지나면 풀린다.',
    '처리 지연 수치는 축소 환경 값이다. 성능 수치가 아니다.',
  ],
  startedAt: new Date().toISOString(),
  checks: {},
};
const check = (name, pass, detail = {}) => {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

const sql = (statement) => execFileSync('docker', ['exec', '-i', 'wonseoro-dev-postgres-univ-a-1', 'psql', '-U', 'wonseoro',
  '-d', 'univ_a', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`], { encoding: 'utf8' }).trim();

async function http(identity, method, path, { body, headers = {} } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...identity, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
    return { status: response.status, json, etag: response.headers.get('etag'), ms: performance.now() - started,
      retryAfter: response.headers.get('retry-after') };
  } catch (error) {
    return { status: 0, error: String(error.cause?.code ?? error.name), ms: performance.now() - started };
  }
}
const key = (step) => ({ 'idempotency-key': `nat-${step}-${randomUUID()}` });

function makeIdentity(prefix) {
  const applicantId = randomUUID();
  return { applicantId, subjectToken: `subj-${prefix}-${applicantId.slice(0, 8)}` };
}
const normals = Array.from({ length: NORMAL }, () => makeIdentity('nat'));
const bots = Array.from({ length: 5 }, () => makeIdentity('bot'));
sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ${
  [...normals, ...bots].map((i) => `('${i.applicantId}','${i.subjectToken}','\\x00','v1')`).join(',')}`);
const headersOf = (i) => ({ 'x-applicant-id': i.applicantId, 'x-subject-token': i.subjectToken });

const stats = { normal: {}, bot: {} };
const causes = {};
const saveMs = [];
function count(kind, step, status, response) {
  if (kind === 'normal' && response && (response.status === 0 || response.status >= 400)) {
    const cause = `${step} ${response.status} ${response.error ?? response.json?.code ?? ''}`;
    causes[cause] = (causes[cause] ?? 0) + 1;
  }
  const bucket = (stats[kind][step] ??= {});
  bucket[status] = (bucket[status] ?? 0) + 1;
}

const deadline = Date.now() + DURATION_MS;

async function normalUser(identity, index) {
  const id = headersOf(identity);
  await sleep(jitter(0, 5_000)); // 한꺼번에 몰리지 않고 몇 초에 걸쳐 들어온다
  const created = await http(id, 'POST', '/api/v1/applications', { headers: key('create'),
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } });
  count('normal', 'create', created.status, created);
  const applicationId = created.json?.id;
  if (!applicationId) return;
  let etag = (await http(id, 'GET', `/api/v1/applications/${applicationId}`)).etag;
  let lastRead = Date.now();
  while (Date.now() < deadline - 10_000) {
    await sleep(jitter(3_000, 5_000));
    const saved = await http(id, 'PATCH', `/api/v1/applications/${applicationId}`, {
      headers: { ...key('save'), 'if-match': etag, 'content-type': 'application/merge-patch+json' },
      body: { fields: { ...FIELDS, academicNote: `${FIELDS.academicNote} (${index}-${Date.now()})` } },
    });
    count('normal', 'save', saved.status, saved);
    saveMs.push(saved.ms);
    if (saved.etag) etag = saved.etag;
    if (Date.now() - lastRead > 15_000) {
      const read = await http(id, 'GET', `/api/v1/applications/${applicationId}`);
      count('normal', 'read', read.status, read);
      if (read.etag) etag = read.etag;
      lastRead = Date.now();
    }
  }
  const intent = await http(id, 'POST', `/api/v1/applications/${applicationId}/payment-intents`, { headers: key('intent') });
  count('normal', 'paymentIntent', intent.status, intent);
  const verified = await http(id, 'POST', `/api/v1/payments/${intent.json?.paymentId}/verify`, { headers: key('verify') });
  count('normal', 'paymentVerify', verified.status, verified);
  const finalized = await http(id, 'POST', `/api/v1/applications/${applicationId}/finalize`, { headers: key('finalize') });
  count('normal', 'finalize', finalized.status, finalized);
}

async function probeBot(identity) {
  const id = headersOf(identity);
  const own = (await http(id, 'POST', '/api/v1/applications', { headers: key('bot-create'),
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } })).json?.id;
  while (Date.now() < deadline) {
    const tick = Array.from({ length: 20 }, () => http(id, 'GET', `/api/v1/applications/${randomUUID()}`)
      .then((r) => count('bot', 'probeOthers', r.status)));
    tick.push(http(id, 'PATCH', `/api/v1/applications/${own}`, { headers: { ...key('bot-save'), 'if-match': '"0"',
      'content-type': 'application/merge-patch+json' }, body: { fields: FIELDS } }).then((r) => count('bot', 'saveOwn', r.status)));
    await Promise.all([...tick, sleep(1_000)]);
  }
}

async function floodBot(identity) {
  const id = headersOf(identity);
  const own = (await http(id, 'POST', '/api/v1/applications', { headers: key('bot-create'),
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } })).json?.id;
  while (Date.now() < deadline) {
    const tick = Array.from({ length: 20 }, () => http(id, 'PATCH', `/api/v1/applications/${own}`, {
      headers: { ...key('bot-save'), 'if-match': '"0"', 'content-type': 'application/merge-patch+json' }, body: { fields: FIELDS },
    }).then((r) => count('bot', 'saveFlood', r.status)));
    for (let k = 0; k < 2; k += 1) {
      tick.push(http(id, 'POST', '/api/v1/applications', { headers: key('bot-create'),
        body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } }).then((r) => count('bot', 'createFlood', r.status)));
    }
    await Promise.all([...tick, sleep(1_000)]);
  }
}

const restarts = () => JSON.parse(execFileSync('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'get', 'pods',
  '-l', 'app=admission-api', '-o', 'json'], { encoding: 'utf8' })).items
  .reduce((sum, pod) => sum + (pod.status.containerStatuses?.[0]?.restartCount ?? 0), 0);
const restartsBefore = restarts();
const ready = await http({}, 'GET', '/readyz');
if (ready.status !== 200) throw new Error(`API not ready: ${ready.status}`);
console.log(`· 시작: 정상 ${NORMAL}명 + 봇 5개, ${DURATION_MS / 1000}초`);
await Promise.all([
  ...normals.map((identity, index) => normalUser(identity, index)),
  ...(WITH_BOTS ? [probeBot(bots[0]), probeBot(bots[1]), floodBot(bots[2]), floodBot(bots[3]), floodBot(bots[4])] : []),
]);

const total = (kind, filter = () => true) => Object.values(stats[kind]).reduce((sum, byStatus) =>
  sum + Object.entries(byStatus).filter(([s]) => filter(Number(s))).reduce((a, [, n]) => a + n, 0), 0);
result.stats = stats;
result.normalFailureCauses = causes;
console.log(`· 정상 사용자 실패 원인 ${JSON.stringify(causes)}`);
const normal429 = total('normal', (s) => s === 429);
const normal5xx = total('normal', (s) => s >= 500 || s === 0);
const bot429 = total('bot', (s) => s === 429);
const botAll = total('bot');
saveMs.sort((a, b) => a - b);
const p95 = saveMs.length ? Math.round(saveMs[Math.floor(saveMs.length * 0.95)]) : null;

// 인수기준(§08 시나리오 11): NAT 뒤 정상 사용자 차단 0. 과부하에도 프로세스가 죽지 않아야 한다.
check('정상 사용자 차단 0 (429 없음)', normal429 === 0, { normal429, normalRequests: total('normal') });
check('API 프로세스 재시작 0', restarts() === restartsBefore, { before: restartsBefore, after: restarts() });
// 용량 관찰 — 축소 환경(API Pod 2·Pod 당 DB 연결 5)의 한계다. 판정에 넣지 않는다. 수치 판정은 K-PaaS 부하 시험(T-M4-30~32)
result.capacity = {
  normalServerErrors: normal5xx,
  normalFinalized: stats.normal.finalize?.['200'] ?? 0,
  botRejectedRatio: botAll ? Math.round((bot429 / botAll) * 1000) / 1000 : null,
  botRequests: botAll,
};
console.log(`· 용량 관찰 ${JSON.stringify(result.capacity)}`);
result.normalSaveLatencyP95Ms = p95;
console.log(`· 정상 자동저장 p95 ${p95}ms (축소 환경)`);

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/nat-bot-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
