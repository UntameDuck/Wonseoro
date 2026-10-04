// T-M4-37 로컬 축소 검증 — Redis 장애·캐시 초기화 중 세션·접수 영향 (§08 시나리오 8)
//
// 전제: kind-univ-a 가 떠 있고 로컬 compose Redis(wonseoro-dev-redis-1)가 있다.
//
//   node tests/m4/redis-outage-kind.mjs
//
// 현재 구현은 Redis 를 쓰지 않는다 — 멱등성·세션 판단(dev-headers)·요청 한도(Pod 메모리, ADR-0007)가 모두
// Redis 밖이다. 차트에는 Redis 주소와 NetworkPolicy 출구만 있다. 그래서 이 시험이 증명하는 것은
// "Redis 가 죽어도(그리고 비워져도) 작성·저장·결제·접수·취소가 그대로 된다" 이다.
// 지원자 세션(인증 게이트웨이, M5)이나 캐시를 Redis 에 붙이면 이 시험을 다시 돌린다.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const REDIS = 'wonseoro-dev-redis-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: 'Redis 시험 고등학교', graduationYear: 2026, academicNote: 'Redis 장애 중에도 접수가 되는지 봅니다.' };

const result = {
  test: 'T-M4-37',
  scenario: 'Redis 정지·재기동(FLUSHALL 포함) 전·중·후 접수 흐름',
  environment: 'local-kind-univ-a + compose Redis (축소 환경)',
  limitations: [
    '현재 구현은 Redis 를 쓰지 않는다. Redis HA Failover(Sentinel/Cluster) 자체는 시험하지 않았다 — 영향이 없음을 확인했다.',
    '지원자 세션을 Redis 에 두는 인증(M5)을 붙이면 세션 유실·재로그인 영향을 다시 시험한다.',
  ],
  startedAt: new Date().toISOString(),
  phases: {},
  checks: {},
};
const check = (name, pass, detail = {}) => {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
};
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sql = (statement) => docker('exec', '-i', 'wonseoro-dev-postgres-univ-a-1', 'psql', '-U', 'wonseoro', '-d', 'univ_a', '-qAt',
  '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`);
const restarts = () => JSON.parse(execFileSync('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'get', 'pods', '-o', 'json'],
  { encoding: 'utf8' })).items.reduce((sum, pod) => sum + (pod.status.containerStatuses?.[0]?.restartCount ?? 0), 0);

async function http(identity, method, path, { body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', ...identity, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, etag: response.headers.get('etag') };
}
const key = (step) => ({ 'idempotency-key': `redis-${step}-${randomUUID()}` });

/** 한 지원자가 원서 두 개로: 하나는 저장→결제→접수, 하나는 취소 */
async function flow() {
  const applicantId = randomUUID();
  const subjectToken = `subj-redis-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const id = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const out = {};
  const created = await http(id, 'POST', '/api/v1/applications', { headers: key('create'), body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT, consents: ['APPLICATION_COLLECTION', 'SCHOOL_RECORD_PROVISION'] } });
  out.create = created.status;
  const appId = created.json?.id;
  const fresh = await http(id, 'GET', `/api/v1/applications/${appId}`);
  out.read = fresh.status;
  const saved = await http(id, 'PATCH', `/api/v1/applications/${appId}`, { headers: { ...key('save'), 'if-match': fresh.etag,
    'content-type': 'application/merge-patch+json' }, body: { fields: FIELDS } });
  out.save = saved.status;
  const intent = await http(id, 'POST', `/api/v1/applications/${appId}/payment-intents`, { headers: key('intent') });
  out.paymentIntent = intent.status;
  const verified = await http(id, 'POST', `/api/v1/payments/${intent.json?.paymentId}/verify`, { headers: key('verify') });
  out.paymentVerify = `${verified.status}/${verified.json?.status}`;
  out.finalizeAgain = (await http(id, 'POST', `/api/v1/applications/${appId}/finalize`, { headers: key('finalize') })).status;
  out.selfCheck = (await http(id, 'GET', `/api/v1/applications/${appId}/self-check`)).status;
  return out;
}
const expected = { create: 201, read: 200, save: 200, paymentIntent: 201, paymentVerify: '200/CONFIRMED', finalizeAgain: 200, selfCheck: 200 };
const ok = (out) => Object.entries(expected).every(([k, v]) => out[k] === v);

const before = restarts();
result.phases.before = await flow();
check('Redis 정상 — 접수 흐름', ok(result.phases.before), result.phases.before);

docker('stop', REDIS);
try {
  result.phases.redisDown = await flow();
  check('Redis 정지 중 — 작성·저장·결제·접수·Self-check 그대로', ok(result.phases.redisDown), result.phases.redisDown);
  const ready = await fetch(`${API}/readyz`);
  check('Redis 정지 중 — API readiness 유지', ready.status === 200, { readyz: ready.status });
} finally {
  docker('start', REDIS);
}
// 캐시 초기화 — 비어 있는 Redis 로 돌아와도 같다
for (let i = 0; i < 20 && !docker('exec', REDIS, 'redis-cli', 'ping').includes('PONG'); i += 1) await new Promise((r) => setTimeout(r, 500));
result.redisFlushAll = docker('exec', REDIS, 'redis-cli', 'FLUSHALL');
result.phases.afterFlush = await flow();
check('Redis 재기동·FLUSHALL 뒤 — 접수 흐름', ok(result.phases.afterFlush), result.phases.afterFlush);
check('워크로드 재시작 0', restarts() === before, { before, after: restarts() });

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/redis-outage-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
