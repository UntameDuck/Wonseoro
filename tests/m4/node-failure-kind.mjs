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
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
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
// 부하가 도는 동안 kubectl·docker 를 동기(execFileSync)로 부르면 이 프로세스의 이벤트 루프가 멈춘다.
// 그 사이 요청 20개의 2초 타이머가 한꺼번에 끝나 "전원 timeout" 으로 잘못 센다 — 2026-09-30 실행에서 실제로 그랬다
// (서버 쪽에는 오류가 하나도 없었다). 그래서 전부 비동기로 부르고, 이벤트 루프 지연을 따로 잰다.
const run = promisify(execFile);
const cmd = async (program, args) => (await run(program, args, { encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const kubectl = (...args) => cmd('kubectl', ['--context', CONTEXT, '-n', NS, ...args]);
const kubectlAll = (...args) => cmd('kubectl', ['--context', CONTEXT, ...args]);
const docker = (...args) => cmd('docker', args);
const kubectlSync = (...args) => execFileSync('kubectl', ['--context', CONTEXT, ...args], { encoding: 'utf8', timeout: 60_000 }).trim();
const sql = (statement) => execFileSync('docker', ['exec', '-i', 'wonseoro-dev-postgres-univ-a-1', 'psql', '-U', 'wonseoro', '-d', 'univ_a',
  '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`], { encoding: 'utf8' }).trim();

// 부하(지원자 20명)는 kind Docker 네트워크 안의 컨테이너가 만든다 — tests/m4/helpers/load-users.mjs 머리말 참고.
// 호스트 → Docker Desktop 포트 전달(localhost:18082)은 노드 컨테이너를 멈출 때 50초 넘게 막혔다. 그 경로로 잰 끊김은
// 노드 장애가 아니라 로컬 도구의 한계였다(2026-09-30 구간별 측정). 이 스크립트는 kubectl·docker 로 조율만 한다.
const LOADER_API = 'http://univ-m-control-plane:30081';
let phase = 'setup';
const phaseStart = {}; // 부하 생성기 시계 기준 — 단계 변경을 받은 시각 (기록 시각과 같은 시계)
const records = [];
let loader = null;
const setPhase = (name) => { phase = name; loader?.stdin.write(`${name}\n`); };
function startLoader(identities) {
  const child = spawn('docker', ['run', '--rm', '-i', '--network', 'kind', '-e', `API=${LOADER_API}`,
    '-e', `IDENTITIES=${JSON.stringify(identities)}`, '-v', `${process.cwd().replace(/\\/g, '/')}/tests/m4/helpers:/h:ro`,
    'node:22-alpine', 'node', '/h/load-users.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const done = new Promise((resolve) => child.on('exit', resolve));
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const m = JSON.parse(line);
      if (m.phaseAt) phaseStart[m.phaseAt] = m.at;
      else if (!m.done) records.push(m);
    } catch { /* JSON 아닌 줄 */ }
  });
  return { stdin: child.stdin, done };
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
  // 5초 구간별 요청·첫 시도 실패 — 끊김 구간이 무엇에 묶이는지(노드 판정·엔드포인트·DB 연결) 보려고
  const buckets = {};
  for (const r of rs) {
    const k = Math.floor((r.at - t0) / 5000) * 5;
    buckets[k] ??= [0, 0];
    buckets[k][0] += 1;
    if (!r.firstOk) buckets[k][1] += 1;
  }
  const failureBySeconds = Object.fromEntries(Object.entries(buckets).filter(([, v]) => v[1] > 0).map(([k, v]) => [`${k}s`, `${v[1]}/${v[0]}`]));
  return { failureBySeconds, requests: rs.length, firstAttemptFailures: firstFail.length, userVisibleFailures: userFail.length,
    rawFailureWindowSeconds: window, otherErrors: other.length, otherByStatus, firstFailureErrors: byError,
    firstFailureFromSeconds: firstFail.length ? Math.round((firstFail[0].at - t0) / 100) / 10 : null,
    lastFailureFromSeconds: firstFail.length ? Math.round((firstFail.at(-1).at - t0) / 100) / 10 : null };
}

// 종료 중인 Pod 는 빼고 센다 — rollout 직후 옛 Pod 가 아직 Ready 로 보여 분산을 잘못 판정한 적이 있다
const podsOf = async (app) => JSON.parse(await kubectl('get', 'pods', '-l', `app=${app}`, '-o', 'json')).items
  .filter((p) => !p.metadata.deletionTimestamp)
  .map((p) => ({ name: p.metadata.name, node: p.spec.nodeName, ready: p.status.containerStatuses?.[0]?.ready === true }));
const apiPods = () => podsOf('admission-api');
async function waitApiReady(count, timeoutMs = 600_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await apiPods()).filter((p) => p.ready).length >= count) return;
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
for (const node of JSON.parse(await kubectlAll('get', 'nodes', '-o', 'json')).items.map((n) => n.metadata.name)) {
  if (node.includes('worker')) { await docker('start', node); await kubectlAll('uncordon', node); }
}
process.on('exit', () => {
  for (const node of ['univ-m-worker', 'univ-m-worker2']) {
    try { execFileSync('docker', ['start', node]); kubectlSync('uncordon', node); } catch { /* 이미 정상 */ }
  }
});
await waitApiReady(2);
result.placement = { api: await apiPods(), pgbouncer: (await podsOf('pgbouncer')).map((p) => p.node) };
mark('배치', result.placement);
check('API 가 zone 두 곳에 나뉘어 있다', new Set(result.placement.api.map((p) => p.node)).size === 2, result.placement);

// 이벤트 루프 지연 — 이 값이 크면 실패가 서버가 아니라 측정 도구 탓일 수 있다
const loopLag = {};
let lastTick = Date.now();
const lagTimer = setInterval(() => {
  const now = Date.now();
  loopLag[phase] = Math.max(loopLag[phase] ?? 0, now - lastTick - 100);
  lastTick = now;
}, 100);
loader = startLoader(identities);
// 준비(컨테이너 기동·원서 생성)가 끝나 모든 지원자가 한 번씩 요청할 때까지 기다린 뒤 평시를 잰다
for (let i = 0; i < 60 && records.length < USERS; i++) await sleep(1_000);
if (records.length < USERS) throw new Error(`부하 생성기가 시작되지 않았다 (기록 ${records.length}건)`);
setPhase('baseline');
mark('평시 시작');
await sleep(20_000);

// ── 계획 정비: drain ─────────────────────────────────────
const drainNode = (await apiPods())[0].node;
setPhase('drain');
mark('drain 시작', { node: drainNode });
await kubectlAll('drain', drainNode, '--ignore-daemonsets', '--delete-emptydir-data', '--timeout=300s');
mark('drain 끝', { api: await apiPods() });
await sleep(20_000);
await kubectlAll('uncordon', drainNode);
await waitApiReady(2);
mark('uncordon·API 2개 복구', { api: await apiPods() });

// ── 정비 뒤 재분산 ──────────────────────────────────────
// 쿠버네티스는 uncordon 뒤 Pod 를 다시 나누지 않는다. nodeTaintsPolicy Honor 면 drain 동안 cordon 된 zone 이
// 분산 계산에서 빠져 API·PgBouncer 가 한 zone 에 모인다 — 그대로 두면 다음 노드 장애가 전체 장애가 된다
// (2026-09-30 실측, ADR-0008). 운영 절차: uncordon 뒤 rollout restart(또는 descheduler)로 다시 나눈다.
const zonesNow = async () => ({
  api: new Set((await apiPods()).filter((p) => p.ready).map((p) => p.node)).size,
  pgbouncer: new Set((await podsOf('pgbouncer')).filter((p) => p.ready).map((p) => p.node)).size,
});
const settle = async () => { // 옛 Pod 가 다 사라질 때까지
  for (let i = 0; i < 60; i++) {
    const terminating = JSON.parse(await kubectl('get', 'pods', '-o', 'json')).items.filter((p) => p.metadata.deletionTimestamp).length;
    if (terminating === 0) return;
    await sleep(2_000);
  }
};
result.afterDrain = await zonesNow();
mark('정비 뒤 배치', { zones: result.afterDrain, api: await apiPods() });
setPhase('rebalance');
if (result.afterDrain.api < 2 || result.afterDrain.pgbouncer < 2) {
  for (const app of ['admission-api', 'pgbouncer']) {
    const deploy = await kubectl('get', 'deploy', '-l', `app=${app}`, '-o', 'name');
    await kubectl('rollout', 'restart', deploy);
    await kubectl('rollout', 'status', deploy, '--timeout=300s');
  }
  await settle();
  await waitApiReady(2);
}
result.afterRebalance = await zonesNow();
mark('재분산 뒤 배치', { zones: result.afterRebalance, api: await apiPods() });
check('정비 뒤 API·PgBouncer 가 다시 두 zone 에 나뉜다', result.afterRebalance.api === 2 && result.afterRebalance.pgbouncer === 2, result.afterRebalance);
await sleep(15_000);

// ── 노드 장애: 강제 정지 ────────────────────────────────
result.beforeFailure = { api: await apiPods(), pgbouncer: await podsOf('pgbouncer') };
const failNode = result.beforeFailure.api[0].node;
setPhase('hard-failure');
await docker('stop', '-t', '0', failNode);
const stoppedAt = Date.now();
mark('노드 강제 정지', { node: failNode });
let notReadyAt = null;
let evictedAt = null;
// 살아남는 API Pod — 그 안에서 자기 자신(127.0.0.1)을 찌른다. 네트워크 정책·kube-proxy 를 모두 건너뛴다
const survivorPod = result.beforeFailure.api.find((p) => p.node !== failNode);
const survivor = survivorPod ? { name: survivorPod.name, ip: '127.0.0.1', prober: survivorPod.name } : null;
const survivorIp = survivorPod ? JSON.parse(await kubectl('get', 'pod', survivorPod.name, '-o', 'json')).status.podIP : null;
// 바깥 경로를 구간별로 잰다: ① 호스트 → Docker Desktop 포트 전달(18082) → NodePort
// ② 제어 노드 안에서 NodePort(kube-proxy) ③ 제어 노드 → 살아남은 Pod IP(노드 간 Pod 네트워크)
const curlIn = (url) => docker('exec', 'univ-m-control-plane', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}/%{time_total}', '--max-time', '3', url)
  .catch((e) => `ERR/${String(e.stdout ?? '').trim() || 'timeout'}`);
const hostProbe = async () => {
  const s = Date.now();
  try { const r = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(3000) }); return `${r.status}/${Date.now() - s}ms`; } catch { return `ERR/${Date.now() - s}ms`; }
};
result.survivor = survivor;
while (Date.now() - stoppedAt < 150_000) {
  const ready = await kubectlAll('get', 'node', failNode, '-o', 'jsonpath={.status.conditions[?(@.type=="Ready")].status}');
  if (!notReadyAt && ready !== 'True') { notReadyAt = Date.now(); mark('노드 NotReady 판정', { afterSeconds: Math.round((notReadyAt - stoppedAt) / 1000) }); }
  // 쿠버네티스는 NotReady 뒤 기본 300초가 지나야 죽은 노드의 Pod 를 내쫓는다. 그 시점을 당겨 대체 Pod 가
  // 살아 있는 zone 에 놓이는지 본다 — zone 이 2개이고 DoNotSchedule 이면 nodeTaintsPolicy 에 달렸다 (D-52)
  if (notReadyAt && !evictedAt && Date.now() - notReadyAt > 10_000) {
    for (const p of (await apiPods()).filter((x) => x.node === failNode)) {
      try { await kubectl('delete', 'pod', p.name, '--force', '--grace-period=0'); } catch { /* 이미 없다 */ }
    }
    evictedAt = Date.now();
    mark('죽은 노드의 API Pod 축출(당김)', {});
  }
  // DB 쪽에서 무엇이 매달려 있는가 — 죽은 노드의 PgBouncer 가 남긴 트랜잭션·잠금 대기 (ADR-0008)
  try {
    const rows = await docker('exec', '-i', 'wonseoro-dev-postgres-univ-a-1', 'psql', '-U', 'wonseoro', '-d', 'univ_a', '-qAt', '-c',
      `SELECT coalesce(state,'-') || '|' || coalesce(wait_event_type,'-') || '|' || count(*) || '|' ||
              coalesce(extract(epoch FROM max(now() - xact_start))::int, 0)
         FROM pg_stat_activity WHERE datname = 'univ_a' AND pid <> pg_backend_pid() AND backend_type = 'client backend'
        GROUP BY state, wait_event_type`);
    (result.dbSamples ??= []).push({ afterSeconds: Math.round((Date.now() - stoppedAt) / 1000),
      sessions: rows.split('\n').filter(Boolean).map((l) => { const [state, wait, n, oldestXactS] = l.split('|'); return { state, wait, n: Number(n), oldestXactS: Number(oldestXactS) }; }) });
  } catch { /* 표본 실패는 시험을 멈추지 않는다 */ }
  // 살아남은 API Pod 를 클러스터 안에서 직접 찌른다 — NodePort·kube-proxy 를 거치지 않는다.
  // /healthz(DB 없음)가 느리면 Pod 자체가, /readyz(DB 포함)만 느리면 DB 경로가, 둘 다 빠르면 바깥 경로가 문제다.
  if (survivor) {
    try {
      const probe = await kubectl('exec', survivor.prober, '--', 'node', '-e', `
        const t=async(p)=>{const s=Date.now();try{const r=await fetch('http://${survivor.ip}:3001'+p,{signal:AbortSignal.timeout(3000)});return r.status+'/'+(Date.now()-s)}catch(e){return 'ERR/'+(Date.now()-s)}};
        Promise.all([t('/healthz'),t('/readyz')]).then(v=>console.log(v.join(' ')))`);
      const [host, nodePort, podNet] = await Promise.all([
        hostProbe(),
        curlIn('http://127.0.0.1:30081/healthz'),
        survivorIp ? curlIn(`http://${survivorIp}:3001/healthz`) : Promise.resolve('-'),
      ]);
      (result.survivorProbes ??= []).push({ afterSeconds: Math.round((Date.now() - stoppedAt) / 1000), probe, host, nodePort, podNet });
    } catch (error) {
      (result.survivorProbes ??= []).push({ afterSeconds: Math.round((Date.now() - stoppedAt) / 1000), probe: `exec 실패 ${String(error.message).slice(0, 80)}` });
    }
  }
  if (evictedAt && !result.replacement) {
    const live = (await apiPods()).filter((p) => p.ready && p.node !== failNode);
    if (live.length >= 2) {
      result.replacement = { scheduled: true, afterSeconds: Math.round((Date.now() - evictedAt) / 1000), api: live };
      mark('대체 API Pod Ready (살아 있는 zone)', result.replacement);
    }
  }
  await sleep(5_000);
}
result.nodeTaintsPolicy = JSON.parse(await kubectl('get', 'deploy', '-l', 'app=admission-api', '-o', 'json'))
  .items[0]?.spec.template.spec.topologySpreadConstraints?.[0]?.nodeTaintsPolicy ?? 'Ignore(기본)';
if (!result.replacement) {
  const pending = JSON.parse(await kubectl('get', 'pods', '-l', 'app=admission-api', '-o', 'json')).items
    .filter((p) => p.status.phase === 'Pending')
    .map((p) => ({ name: p.metadata.name, reason: p.status.conditions?.find((c) => c.type === 'PodScheduled')?.message }));
  result.replacement = { scheduled: false, pending };
  mark('대체 API Pod 배치 실패', result.replacement);
}
setPhase('recovery');
await docker('start', failNode);
mark('노드 재기동', { node: failNode });
await waitApiReady(2);
mark('API 2개 복구', { api: await apiPods() });
await sleep(20_000);
loader.stdin.write('stop\n');
await loader.done;
clearInterval(lagTimer);
result.eventLoopMaxLagMs = loopLag;

for (const name of ['baseline', 'drain', 'rebalance', 'hard-failure', 'recovery']) result.phases[name] = summarize(name);
result.nodeNotReadyAfterSeconds = notReadyAt ? Math.round((notReadyAt - stoppedAt) / 1000) : null;
console.log(JSON.stringify(result.phases));

check('측정 도구의 이벤트 루프가 막히지 않았다 (최대 지연 < 500ms)', Object.values(loopLag).every((v) => v < 500), loopLag);
check('평시 실패 0', result.phases.baseline.firstAttemptFailures === 0, result.phases.baseline);
check('계획 정비(drain) 무중단 — 첫 시도부터 실패 0', result.phases.drain.firstAttemptFailures === 0, result.phases.drain);
check('노드 강제 정지 — 사용자 체감 실패 0 (재시도 3회 안에 성공)', result.phases['hard-failure'].userVisibleFailures === 0, result.phases['hard-failure']);
check('노드 복구 뒤 실패 0', result.phases.recovery.userVisibleFailures === 0, result.phases.recovery);
check('재분산(rollout restart) 중 사용자 체감 실패 0', result.phases.rebalance.userVisibleFailures === 0, result.phases.rebalance);
if (result.nodeTaintsPolicy === 'Honor') {
  // Honor 면 죽은 zone 을 분산 계산에서 빼므로 대체 Pod 가 살아 있는 zone 에 놓여야 한다 (D-52)
  check('죽은 zone 을 빼고 대체 API Pod 를 배치한다 (nodeTaintsPolicy Honor)', result.replacement.scheduled === true, result.replacement);
}

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/node-failure-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
