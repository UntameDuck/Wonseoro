// 비상 역할(break-glass) 회수·경보 — kind 에서 실제 CronJob 으로 (T-M5-03, docs/13 단계 5)
//
// 사용: kind-univ-a 클러스터. npm run test:security:break-glass  (약 3분)
// 하는 일 — 시험 네임스페이스에 차트의 RBAC·회수 작업을 렌더링해 올린다
//   1. 끝나는 시각 없이·12시간 넘게는 켤 수 없다(렌더링 거부)
//   2. 90초짜리로 켠다 → 바인딩·회수 CronJob. 회수 작업 권한은 그 바인딩 하나·이벤트 쓰기뿐
//   3. 켜져 있는 동안 회수 작업이 Warning 이벤트 BreakGlassActive 를 남긴다(경보)
//   4. 끝나는 시각이 지나면 **예약된** 회수 작업이 바인딩을 지우고 BreakGlassRevoked — 비상 그룹 권한이 사라진다
//   5. 끝난 뒤 다시 렌더링하면 바인딩이 없다(GitOps 가 되살리지 않는다)
// 결과는 tests/security/results/break-glass-kind-<시각>.json
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTEXT = process.argv.find((a) => a.startsWith('--context='))?.split('=')[1] ?? 'kind-univ-a';
const NS = 'kadmission-break-glass-test';
const RELEASE = 'univ-a';
const BINDING = `${RELEASE}-break-glass`;
const REAPER = `${RELEASE}-break-glass-reaper`;
const GROUP = 'kadmission-break-glass';
const DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function kubectl(args, { input, as } = {}) {
  const who = as ? [`--as=${as}`, `--as-group=${GROUP}`] : [];
  const r = spawnSync('kubectl', [`--context=${CONTEXT}`, ...who, ...args], { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
function render(extra) {
  return spawnSync('helm', [
    'template', RELEASE, path.join(ROOT, 'deploy/charts/k-admission'), '--namespace', NS,
    '-f', path.join(ROOT, 'deploy/charts/k-admission/values.yaml'), '-f', path.join(ROOT, 'deploy/charts/k-admission/values-m.yaml'),
    '--set', `api.image.digest=${DIGEST}`, '--set', `eventRelay.image.digest=${DIGEST}`, '--set', `documentService.image.digest=${DIGEST}`,
    '--set', `database.pooler.image.digest=${DIGEST}`, '--set', 'documentService.scannerEngine=x', '--set', 'runtimeSecret.name=r',
    '--show-only', 'templates/rbac.yaml', '--show-only', 'templates/break-glass.yaml',
    ...extra,
  ], { encoding: 'utf8' });
}
const on = (expiresAt) => ['--set', `rbac.breakGlass.group=${GROUP}`, '--set', `rbac.breakGlass.expiresAt=${expiresAt}`, '--set', 'rbac.breakGlass.reason=비상 역할 회수 시험'];
const events = (reason) =>
  kubectl(['get', 'events', '-n', NS, '--field-selector', `reason=${reason},involvedObject.name=${BINDING}`, '-o', 'jsonpath={.items[*].message}']).out;

try {
  kubectl(['delete', 'namespace', NS, '--wait=true', '--ignore-not-found']);
  kubectl(['create', 'namespace', NS]);
  // 회수 작업 이미지(node:22-alpine) — 없으면 kind 노드에 올린다
  const has = spawnSync('docker', ['exec', `${CONTEXT.replace(/^kind-/, '')}-control-plane`, 'crictl', 'images', '-q', 'docker.io/library/node:22-alpine'], { encoding: 'utf8' });
  if (!has.stdout?.trim()) execFileSync('kind', ['load', 'docker-image', 'node:22-alpine', '--name', CONTEXT.replace(/^kind-/, '')], { stdio: 'ignore' });

  // 1. 렌더링 거부
  const far = render(on(new Date(Date.now() + 13 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z')));
  check(far.status !== 0 && /12시간/.test(far.stderr), '12시간 넘게는 켤 수 없다(렌더링 거부)');

  // 2. 90초짜리로 켠다
  const expiresAt = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const r = render(on(expiresAt));
  const applied = kubectl(['apply', '-n', NS, '-f', '-'], { input: r.stdout });
  const bound = kubectl(['get', 'rolebinding', BINDING, '-n', NS, '-o', 'jsonpath={.metadata.annotations.kadmission\\.kr/break-glass-expires-at}']);
  check(applied.ok && bound.out === expiresAt, '90초짜리 비상 역할 켜기 — 바인딩·회수 CronJob', { expiresAt, applied: applied.ok });
  const sa = `system:serviceaccount:${NS}:${REAPER}`;
  const can = (verb, res) => kubectl(['auth', 'can-i', verb, res, '-n', NS, `--as=${sa}`]).out === 'yes';
  const reaperPerms = {
    deleteThisBinding: can('delete', `rolebindings/${BINDING}`),
    deleteOtherBinding: can('delete', 'rolebindings/other'),
    createBinding: can('create', 'rolebindings'),
    getSecrets: can('get', 'secrets'),
    createEvents: can('create', 'events'),
  };
  check(
    reaperPerms.deleteThisBinding && reaperPerms.createEvents && !reaperPerms.deleteOtherBinding && !reaperPerms.createBinding && !reaperPerms.getSecrets,
    '회수 작업 권한은 그 바인딩 하나 지우기·이벤트 쓰기뿐',
    reaperPerms,
  );
  const oncallBefore = kubectl(['auth', 'can-i', 'get', 'secrets', '-n', NS, `--as=oncall`, `--as-group=${GROUP}`]).out;
  check(oncallBefore === 'yes', '켜져 있는 동안 비상 그룹은 장애 대응 권한이 있다', { getSecrets: oncallBefore });

  // 3. 켜져 있는 동안 경보 — 지금 한 번 돌려 본다(예약은 매분)
  kubectl(['create', 'job', '-n', NS, '--from', `cronjob/${REAPER}`, 'reaper-now']);
  const done = kubectl(['wait', '-n', NS, '--for=condition=complete', 'job/reaper-now', '--timeout=120s']);
  const active = events('BreakGlassActive');
  const logs = kubectl(['logs', '-n', NS, 'job/reaper-now']).out;
  check(done.ok && /그룹 kadmission-break-glass/.test(active) && /"level":"warn"/.test(logs), '켜져 있는 동안 회수 작업이 Warning 이벤트·경고 로그를 남긴다(경보)', {
    job: done.ok,
    event: active.slice(0, 80),
  });

  // 4. 끝나는 시각이 지나면 예약된 회수 작업이 지운다
  const deadline = Date.parse(expiresAt);
  let revokedAt = null;
  while (Date.now() < deadline + 150_000) {
    await sleep(5_000);
    if (Date.now() > deadline && !kubectl(['get', 'rolebinding', BINDING, '-n', NS]).ok) {
      revokedAt = Date.now();
      break;
    }
  }
  const lag = revokedAt ? Math.round((revokedAt - deadline) / 1000) : null;
  check(revokedAt !== null && lag <= 90, '끝나는 시각이 지나면 예약된 회수 작업이 바인딩을 지운다', { secondsAfterExpiry: lag });
  await sleep(3_000);
  check(/회수했다/.test(events('BreakGlassRevoked')), '회수하면 Warning 이벤트 BreakGlassRevoked');
  const oncallAfter = kubectl(['auth', 'can-i', 'get', 'secrets', '-n', NS, `--as=oncall`, `--as-group=${GROUP}`]).out;
  check(oncallAfter === 'no', '회수 뒤 비상 그룹 권한이 없다', { getSecrets: oncallAfter });

  // 5. 다시 렌더링해도 바인딩이 없다
  const again = render(on(expiresAt));
  const kinds = [...again.stdout.matchAll(/kind: RoleBinding\nmetadata:\n  name: (\S+)/g)].map((m) => m[1]);
  check(again.status === 0 && !kinds.includes(BINDING), '끝난 뒤 다시 렌더링하면 비상 역할 바인딩이 없다(GitOps 가 되살리지 않는다)', { bindings: kinds });
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  kubectl(['delete', 'namespace', NS, '--wait=false', '--ignore-not-found']);
}

const result = {
  test: '비상 역할 회수·경보 (T-M5-03)',
  environment: '축소 환경 — 로컬 kind(kind-univ-a), 시험 네임스페이스',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/security/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `break-glass-kind-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 비상 역할 회수 ${steps.length}개 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exit(result.passed ? 0 : 1);
