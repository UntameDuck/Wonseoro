// T-M4-39 부분 검증 — API Pod 강제 종료·RollingUpdate 중 연속 요청
//
// 로컬 kind는 대학당 단일 노드이므로 노드 전체 장애의 무중단은 검증할 수 없다.
// 현재 가능한 범위인 2개 API Pod 중 하나 강제 삭제와 RollingUpdate 동안 대학 카탈로그
// 요청을 계속 보내 오류가 없는지 확인한다. 결과에는 이 한계를 명시한다.
//
//   node tests/m4/api-pod-restart.mjs
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';

const exec = promisify(execFile);
const API = 'http://localhost:18081';
const result = {
  test: 'T-M4-39-partial',
  environment: 'local-kind-univ-a (축소·단일 노드 환경)',
  limitation: '단일 kind 노드이므로 노드 전체 장애 무중단은 미검증. Pod 강제 종료·RollingUpdate만 검증.',
  startedAt: new Date().toISOString(),
  checks: {},
  phases: {},
};

function kubectl(args) {
  return exec('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 240_000,
  });
}

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

async function requestOnce() {
  const started = performance.now();
  try {
    const response = await fetch(`${API}/api/v1/admission-cycles/current`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'cache-control': 'no-cache' },
    });
    await response.arrayBuffer();
    return { ok: response.status === 200, status: response.status, latencyMs: performance.now() - started };
  } catch (error) {
    return { ok: false, status: error.name === 'TimeoutError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message), latencyMs: performance.now() - started };
  }
}

async function exercise(name, disrupt) {
  const samples = [];
  let running = true;
  const load = (async () => {
    while (running) {
      samples.push(await requestOnce());
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const disruptedAt = new Date().toISOString();
  await disrupt();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  running = false;
  await load;

  const failed = samples.filter((sample) => !sample.ok);
  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null;
  const summary = {
    disruptedAt,
    requests: samples.length,
    failures: failed.length,
    failureStatuses: failed.reduce((acc, sample) => {
      const key = String(sample.status);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    p95Ms: p95 === null ? null : Math.round(p95 * 10) / 10,
    maxMs: latencies.length ? Math.round(latencies.at(-1) * 10) / 10 : null,
  };
  result.phases[name] = summary;
  return summary;
}

try {
  const ready = await requestOnce();
  if (!ready.ok) throw new Error(`UNIV-A API not ready: ${ready.status}`);
  const before = JSON.parse(execFileSync(
    'kubectl',
    ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'get', 'deployment/univ-a-api', '-o', 'json'],
    { encoding: 'utf8' },
  ));
  check('deployment-has-two-replicas', before.spec.replicas === 2 && before.status.readyReplicas === 2, {
    desired: before.spec.replicas,
    ready: before.status.readyReplicas,
  });
  check('rolling-strategy-is-zero-unavailable', String(before.spec.strategy.rollingUpdate.maxUnavailable) === '0', {
    maxUnavailable: before.spec.strategy.rollingUpdate.maxUnavailable,
    maxSurge: before.spec.strategy.rollingUpdate.maxSurge,
  });

  const podNames = (await kubectl(['get', 'pods', '-l', 'app=admission-api', '-o', 'jsonpath={.items[*].metadata.name}'])).stdout.trim().split(/\s+/);
  const deletedPod = podNames[0];
  const podDelete = await exercise('forced-pod-delete', async () => {
    await kubectl(['delete', 'pod', deletedPod, '--wait=false']);
    await kubectl(['rollout', 'status', 'deployment/univ-a-api', '--timeout=180s']);
  });
  check('forced-pod-delete-has-zero-request-errors', podDelete.requests > 0 && podDelete.failures === 0, podDelete);

  const rolling = await exercise('rolling-restart', async () => {
    await kubectl(['rollout', 'restart', 'deployment/univ-a-api']);
    await kubectl(['rollout', 'status', 'deployment/univ-a-api', '--timeout=180s']);
  });
  check('rolling-restart-has-zero-request-errors', rolling.requests > 0 && rolling.failures === 0, rolling);

  const after = JSON.parse((await kubectl(['get', 'deployment/univ-a-api', '-o', 'json'])).stdout);
  check('deployment-returns-to-two-ready-replicas', after.spec.replicas === 2 && after.status.readyReplicas === 2, {
    desired: after.spec.replicas,
    ready: after.status.readyReplicas,
  });
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
}

result.finishedAt = new Date().toISOString();
result.passed = !result.error && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/api-pod-restart-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
