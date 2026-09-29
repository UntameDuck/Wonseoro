// T-M4-39 로컬 축소 검증 — API 노드 장애 중 무중단 (§08 시나리오 10)
//
// 전제: kind-univ-a-multinode.yaml 로 만든 univ-m(제어 1 + 워커 2, zone-a/zone-b)에 values-multinode.yaml 로 배포돼 있다.
//   API 2개·PgBouncer 2개가 zone 별로 한 개씩 놓인다. NodePort → 호스트 18082.
//
//   node tests/m4/node-failure-kind.mjs
//
// 지원자 20명이 1초마다 조회, 3초마다 자동저장(사람의 자동저장 속도)을 보내는 동안
//   ① 평시 → ② API 가 있는 워커 drain(계획 정비) → uncordon → ③ 워커 컨테이너 강제 정지(노드 장애) → 재기동
// 각 요청은 브라우저 자동저장처럼 같은 Idempotency-Key 로 1초 간격 최대 3번 시도한다.
//   원시 실패: 첫 시도 실패 / 사용자 체감 실패: 세 번 모두 실패
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18082';
const CONTEXT = 'kind-univ-m';
const NS = 'kadmission-app';
const USERS = 20;
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

const result = {
  test: 'T-M4-39',
  scenario: 'API 노드 계획 정비(drain)·강제 정지 중 연속 조회·자동저장',
  environment: 'local-kind-univ-m (제어 1 + 워커 2, zone 2개, 축소 환경)',
  limitations: [
    'kind 노드는 Docker 컨테이너다. 노드 강제 정지는 docker stop 으로 흉내 냈다.',
    '노드가 NotReady 로 판정되기까지(kube-controller-manager node-monitor-grace-period) Service 가 죽은 Pod 로 요청을 보낸다 — kind 기본값을 그대로 썼다.',
    'Edge/Ingress 의 재시도·능동 헬스체크는 없다. 요청은 NodePort(kube-proxy) 로 바로 간다.',
  ],
  startedAt: new Date().toISOString(),
  phases: {},
  checks: {},
  timeline: [],
};
const check = (name, pass, detail = {}) => {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
};
const mark = (event, detail = {}) => {
  result.timeline.push({ at: new Date().toISOString(), event, ...detail });
  console.log(`· ${event} ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kubectl = (...args) => execFileSync('kubectl', ['--context', CONTEXT, '-n', NS, ...args], { encoding: 'utf8', timeout: 600_000 }).trim();
const kubectlAll = (...args) => execFileSync('kubectl', ['--context', CONTEXT, ...args], { encoding: 'utf8', timeout: 600_000 }).trim();
const sql = (statement) => execFileSync('docker', ['exec', '-i', 'wonseoro-dev-postgres-univ-a-1', 'psql', '-U', 'wonseoro', '-d', 'univ_a',
  '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`], { encoding: 'utf8' }).trim();

/**
 * 요청마다 새 TCP 연결을 연다(agent: false). keep-alive 로 연결을 재사용하면 kube-proxy 가 연결 단위로만 나눠
 * 모든 요청이 한 Pod 로 몰리고, 다른 노드가 죽어도 트래픽에 닿지 않는다 — 앞선 실행에서 실제로 그랬다.
 */
function attempt(identity, method, path, headers = {}, body, timeoutMs = 2_000) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = httpRequest(`${API}${path}`, {
      method, agent: false, timeout: timeoutMs,
      headers: { 'content-type': 'application/json', ...identity, ...headers, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
        resolve({ status: res.statusCode ?? 0, json, etag: res.headers.etag ?? null });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ status: 0, error: error.message === 'timeout' ? 'timeout' : String(error.code ?? error.message) }));
    if (payload) req.write(payload);
    req.end();
  });
}
const transient = (r) => r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;

/** 같은 요청(같은 멱등키)을 1초 간격 최대 3번 */
async function withRetry(fn) {
  let first;
  for (let i = 0; i < 3; i += 1) {
    const r = await fn();
    first ??= r;
    if (!transient(r)) return { first, final: r, attempts: i + 1 };
    await sleep(1_000);
  }
  return { first, final: { status: 0, error: 'gave-up' }, attempts: 3 };
}

let phase = 'setup';
const phaseStart = {};
const setPhase = (name) => { phase = name; phaseStart[name] = Date.now(); };
const records = [];
let running = true;

async function user(identity) {
  const id = { 'x-applicant-id': identity.applicantId, 'x-subject-token': identity.subjectToken };
  // 준비 단계 — 시험 대상이 아니라 넉넉히 기다린다 (첫 요청은 느리다)
  const created = await attempt(id, 'POST', '/api/v1/applications', { 'idempotency-key': `node-create-${randomUUID()}` },
    { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT }, 30_000);
  const appId = created.json?.id;
  if (!appId) throw new Error(`원서 생성 실패 ${created.status}`);
  let etag = (await attempt(id, 'GET', `/api/v1/applications/${appId}`, {}, undefined, 30_000)).etag;
  let n = 0;
  while (running) {
    const started = Date.now();
    const current = phase;
    let r;
    const isSave = n % 3 === 2;
    if (!isSave) {
      r = await withRetry(() => attempt(id, 'GET', `/api/v1/applications/${appId}`));
      if (r.final.etag) etag = r.final.etag;
    } else {
      const key = `node-save-${randomUUID()}`;
      r = await withRetry(() => attempt(id, 'PATCH', `/api/v1/applications/${appId}`,
        { 'idempotency-key': key, 'if-match': etag, 'content-type': 'application/merge-patch+json' },
        { fields: { highSchool: '노드 장애 시험 고등학교', graduationYear: 2026, selfIntro: `저장 ${n}` } }));
      if (r.final.etag) etag = r.final.etag;
      // 재시도가 이미 반영된 저장을 다시 보낸 경우 412 가 날 수 있다 — 최신 ETag 로 맞춘다
      if (r.final.status === 412) etag = (await attempt(id, 'GET', `/api/v1/applications/${appId}`)).etag ?? etag;
    }
    records.push({ phase: current, at: started, kind: isSave ? 'save' : 'read',
      firstOk: !transient(r.first), finalOk: !transient(r.final), finalStatus: r.final.status, finalCode: r.final.json?.code, attempts: r.attempts,
      firstError: r.first.error ?? `${r.first.status} ${r.first.json?.code ?? ''}` });
    n += 1;
    await sleep(Math.max(0, 1_000 - (Date.now() - started)));
  }
}

function summarize(name) {
  const rs = records.filter((r) => r.phase === name);
  const firstFail = rs.filter((r) => !r.firstOk);
  const userFail = rs.filter((r) => !r.finalOk);
  const window = firstFail.length ? Math.round((firstFail.at(-1).at - firstFail[0].at) / 100) / 10 : 0;
  const other = rs.filter((r) => r.finalOk && r.finalStatus >= 400 && r.finalStatus !== 412);
  const otherByStatus = {};
  for (const r of other) otherByStatus[`${r.kind} ${r.finalStatus} ${r.finalCode ?? ''}`] = (otherByStatus[`${r.kind} ${r.finalStatus} ${r.finalCode ?? ''}`] ?? 0) + 1;
  const byError = {};
  for (const r of firstFail) byError[r.firstError] = (byError[r.firstError] ?? 0) + 1;
  const t0 = phaseStart[name] ?? rs[0]?.at ?? 0;
  return { requests: rs.length, firstAttemptFailures: firstFail.length, userVisibleFailures: userFail.length,
    rawFailureWindowSeconds: window, otherErrors: other.length, otherByStatus, firstFailureErrors: byError,
    firstFailureFromSeconds: firstFail.length ? Math.round((firstFail[0].at - t0) / 100) / 10 : null,
    lastFailureFromSeconds: firstFail.length ? Math.round((firstFail.at(-1).at - t0) / 100) / 10 : null };
}

const apiPods = () => JSON.parse(kubectl('get', 'pods', '-l', 'app=admission-api', '-o', 'json')).items
  .map((p) => ({ name: p.metadata.name, node: p.spec.nodeName, ready: p.status.containerStatuses?.[0]?.ready === true }));
async function waitApiReady(count, timeoutMs = 600_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (apiPods().filter((p) => p.ready).length >= count) return;
    await sleep(3_000);
  }
  throw new Error('API Ready 대기 시간 초과');
}

// ── 준비 ──────────────────────────────────────────────
const identities = Array.from({ length: USERS }, () => {
  const applicantId = randomUUID();
  return { applicantId, subjectToken: `subj-node-${applicantId.slice(0, 8)}` };
});
sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ${
  identities.map((i) => `('${i.applicantId}','${i.subjectToken}','\\x00','v1')`).join(',')}`);
// 지난 실행이 중간에 멈췄으면 워커가 cordon·정지 상태로 남아 있을 수 있다 — 되돌리고 시작한다
for (const node of JSON.parse(kubectlAll('get', 'nodes', '-o', 'json')).items.map((n) => n.metadata.name)) {
  if (node.includes('worker')) { execFileSync('docker', ['start', node]); kubectlAll('uncordon', node); }
}
process.on('exit', () => {
  for (const node of ['univ-m-worker', 'univ-m-worker2']) {
    try { execFileSync('docker', ['start', node]); kubectlAll('uncordon', node); } catch { /* 이미 정상 */ }
  }
});
await waitApiReady(2);
result.placement = { api: apiPods(), pgbouncer: JSON.parse(kubectl('get', 'pods', '-l', 'app=pgbouncer', '-o', 'json')).items.map((p) => p.spec.nodeName) };
mark('배치', result.placement);
check('API 가 zone 두 곳에 나뉘어 있다', new Set(result.placement.api.map((p) => p.node)).size === 2, result.placement);

const users = identities.map((i) => user(i));
await sleep(5_000); // 준비(원서 생성)가 끝나고 평시를 잰다
setPhase('baseline');
mark('평시 시작');
await sleep(20_000);

// ── 계획 정비: drain ─────────────────────────────────────
const drainNode = apiPods()[0].node;
setPhase('drain');
mark('drain 시작', { node: drainNode });
kubectlAll('drain', drainNode, '--ignore-daemonsets', '--delete-emptydir-data', '--timeout=300s');
mark('drain 끝', { api: apiPods() });
await sleep(20_000);
kubectlAll('uncordon', drainNode);
await waitApiReady(2);
mark('uncordon·API 2개 복구', { api: apiPods() });
await sleep(15_000);

// ── 노드 장애: 강제 정지 ────────────────────────────────
const failNode = apiPods()[0].node;
setPhase('hard-failure');
execFileSync('docker', ['stop', '-t', '0', failNode]);
const stoppedAt = Date.now();
mark('노드 강제 정지', { node: failNode });
let notReadyAt = null;
while (Date.now() - stoppedAt < 150_000) {
  const ready = kubectlAll('get', 'node', failNode, '-o', 'jsonpath={.status.conditions[?(@.type=="Ready")].status}');
  if (!notReadyAt && ready !== 'True') { notReadyAt = Date.now(); mark('노드 NotReady 판정', { afterSeconds: Math.round((notReadyAt - stoppedAt) / 1000) }); }
  await sleep(5_000);
}
setPhase('recovery');
execFileSync('docker', ['start', failNode]);
mark('노드 재기동', { node: failNode });
await waitApiReady(2);
mark('API 2개 복구', { api: apiPods() });
await sleep(20_000);
running = false;
await Promise.all(users);

for (const name of ['baseline', 'drain', 'hard-failure', 'recovery']) result.phases[name] = summarize(name);
result.nodeNotReadyAfterSeconds = notReadyAt ? Math.round((notReadyAt - stoppedAt) / 1000) : null;
console.log(JSON.stringify(result.phases));

check('평시 실패 0', result.phases.baseline.firstAttemptFailures === 0, result.phases.baseline);
check('계획 정비(drain) 무중단 — 첫 시도부터 실패 0', result.phases.drain.firstAttemptFailures === 0, result.phases.drain);
check('노드 강제 정지 — 사용자 체감 실패 0 (재시도 3회 안에 성공)', result.phases['hard-failure'].userVisibleFailures === 0, result.phases['hard-failure']);
check('노드 복구 뒤 실패 0', result.phases.recovery.userVisibleFailures === 0, result.phases.recovery);

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/node-failure-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
