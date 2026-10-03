// Kubernetes 역할 6종 — kind 에서 역할별 허용·거절 행렬 (§06 RBAC, T-M5-02 단계 8, D-68)
//
// 사용: kind 클러스터(kind-univ-a, HANDOFF §3)가 떠 있을 때
//       npm run test:auth:k8s            (다른 클러스터: -- --context=kind-univ-b)
// 하는 일
//   1. 차트의 RBAC 만 렌더링해 시험 네임스페이스(kadmission-rbac-test)에 적용한다 — 배포된 univ-a 릴리스는 건드리지 않는다
//   2. 재현: 승인 정책 바인딩을 잠시 빼고 sre 가 Secret 참조를 넣을 수 있음을 보인 뒤, 플랫폼 승인 정책
//      (deploy/platform/rbac/sre-operator-guard.yaml)을 적용한다(멱등, 남겨 둔다 — 플랫폼 설정이다)
//   3. 사람 역할을 흉내(--as/--as-group)로 `kubectl auth can-i` 행렬 — 허용해야 할 것과 거절해야 할 것을 모두 본다
//   4. sre-operator 의 Deployment 수정: 규모·재시작은 되고, Secret 참조·이미지·라벨 변경은 승인 정책이 막는다
//   5. break-glass: 평소 아무 권한 없음 → 차트 값으로 켜면(끝나는 시각·사유 필수) 권한이 생김 → 끄면 다시 없음
//   6. 배포 계정(gitops release-controller)이 차트 RBAC 을 만들 수 있다 — Kubernetes 는 자기 권한 밖의 Role·바인딩을 못
//      만들게 한다. 배포 계정과 같은 Role(deploy/gitops/base/reconciler-rbac.yaml)을 시험 네임스페이스에 두고 그 계정으로
//      실제 적용한다(서버 dry-run 은 새 Role 이 생기지 않아 바인딩 검사를 할 수 없다). 실제 배포 계정은 네임스페이스 밖·
//      클러스터 범위를 못 한다
//   시험 네임스페이스는 끝나면 지운다(이 시험이 만든 것만).
// 결과는 tests/auth/results/k8s-rbac-kind-<시각>.json
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTEXT = process.argv.find((a) => a.startsWith('--context='))?.split('=')[1] ?? 'kind-univ-a';
const NS = 'kadmission-rbac-test';
const APP_NS = 'kadmission-app';
const RELEASE = 'univ-a';
const DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const GROUPS = {
  viewer: 'kadmission-viewers',
  sre: 'kadmission-sre',
  auditor: 'kadmission-auditors',
  admin: 'kadmission-admission-admins',
  breakGlass: 'kadmission-break-glass',
};

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};

function kubectl(args, { input, as } = {}) {
  const who = as ? [`--as=${as.user}`, ...(as.group ? [`--as-group=${as.group}`] : [])] : [];
  const r = spawnSync('kubectl', [`--context=${CONTEXT}`, ...who, ...args], { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function renderRbac(namespace, extra = []) {
  return execFileSync('helm', [
    'template', RELEASE, path.join(ROOT, 'deploy/charts/k-admission'),
    '--namespace', namespace,
    '-f', path.join(ROOT, 'deploy/charts/k-admission/values.yaml'),
    '-f', path.join(ROOT, 'deploy/charts/k-admission/values-m.yaml'),
    '--set', `api.image.digest=${DIGEST}`,
    '--set', `eventRelay.image.digest=${DIGEST}`,
    '--set', `documentService.image.digest=${DIGEST}`,
    '--set', `database.pooler.image.digest=${DIGEST}`,
    '--set', 'documentService.scannerEngine=placeholder-scanner-engine',
    '--set', 'runtimeSecret.name=kadmission-univ-a-runtime',
    '--show-only', 'templates/rbac.yaml',
    ...extra,
  ], { encoding: 'utf8' });
}

/** `kubectl auth can-i` — [동사, 자원(하위 자원은 자원/하위), 기대] */
function canI(persona, as, rows, namespace = NS) {
  const wrong = [];
  for (const [verb, resource, expected] of rows) {
    const [res, sub] = resource.split('/');
    const r = kubectl(['auth', 'can-i', verb, res, ...(sub ? [`--subresource=${sub}`] : []), '-n', namespace], { as });
    const allowed = /^yes/.test(r.out);
    if (allowed !== expected) wrong.push(`${verb} ${resource} → ${allowed ? '허용' : '거절'}(기대 ${expected ? '허용' : '거절'})`);
  }
  check(wrong.length === 0, `${persona} — ${rows.length}칸 (허용 ${rows.filter((r) => r[2]).length}·거절 ${rows.filter((r) => !r[2]).length})`, wrong.length ? wrong : undefined);
  return rows.length;
}
const person = (name, group) => ({ user: `${name}@example.test`, group });

// 어느 사람 역할에도 없어야 하는 것 — 클러스터 범위·RBAC 변경·Secret·exec
const NEVER = [
  ['create', 'clusterrolebindings', false],
  ['create', 'namespaces', false],
  ['create', 'rolebindings', false],
  ['escalate', 'roles', false],
  ['create', 'pods/exec', false],
];

let cells = 0;
try {
  const ver = kubectl(['version', '-o', 'json']);
  if (!ver.ok) throw new Error(`클러스터(${CONTEXT})에 닿지 않는다: ${ver.out.slice(0, 200)}`);
  const server = JSON.parse(ver.out.slice(ver.out.indexOf('{'))).serverVersion?.gitVersion;

  // 준비 — 시험 네임스페이스, 차트 RBAC, 승인 정책, 시험용 Deployment·Secret
  kubectl(['delete', 'namespace', NS, '--wait=true', '--ignore-not-found']);
  check(kubectl(['create', 'namespace', NS]).ok, `시험 네임스페이스 ${NS} (${CONTEXT}, ${server})`);
  const applied = kubectl(['apply', '-n', NS, '-f', '-'], { input: renderRbac(NS) });
  check(applied.ok, '차트 RBAC 적용 — Role 5개·RoleBinding 4개(break-glass 바인딩 없음)', applied.ok ? undefined : applied.out);
  const roles = kubectl(['get', 'role', '-n', NS, '-o', 'name']).out.split('\n').filter(Boolean).map((r) => r.replace(/^.*\//, '').replace(`${RELEASE}-`, '')).sort();
  check(JSON.stringify(roles) === JSON.stringify(['break-glass', 'platform-viewer', 'release-controller', 'security-auditor', 'sre-operator']),
    '역할 5개 + admission-admin 은 Role 없음(Kubernetes 권한 0) = 6종', roles);
  kubectl(['create', 'secret', 'generic', 'probe-secret', '-n', NS, '--from-literal=token=rbac-probe']);
  kubectl(['create', 'deployment', 'guard-probe', '-n', NS, '--image=registry.k8s.io/pause:3.10', '--replicas=0']);

  // 재현 — 승인 정책 없이 RBAC 만이면 sre 가 Secret 참조를 Pod 에 넣을 수 있다(Secret 을 읽을 권한 없이도)
  const SECRET_ENV = '{"spec":{"template":{"spec":{"containers":[{"name":"pause","env":[{"name":"TOKEN","valueFrom":{"secretKeyRef":{"name":"probe-secret","key":"token"}}}]}]}}}}';
  kubectl(['delete', 'validatingadmissionpolicybinding', 'kadmission-sre-operator-guard', '--ignore-not-found']);
  let gap = null;
  for (let k = 0; k < 15 && !gap?.ok; k++) {
    gap = kubectl(['patch', 'deployment', 'guard-probe', '-n', NS, '-p', SECRET_ENV], { as: { user: 'sre@example.test', group: GROUPS.sre } });
    if (!gap.ok) await new Promise((r) => setTimeout(r, 1000));
  }
  check(gap.ok, '재현: 승인 정책 없이는 sre-operator 가 Secret 참조를 Pod 에 넣을 수 있다(RBAC 의 Deployment patch 만으로)', gap.ok ? undefined : gap.out);
  kubectl(['set', 'env', 'deployment/guard-probe', '-n', NS, 'TOKEN-']);
  const guard = kubectl(['apply', '-f', path.join(ROOT, 'deploy/platform/rbac/sre-operator-guard.yaml')]);
  check(guard.ok, '플랫폼 승인 정책 sre-operator-guard 적용', guard.ok ? undefined : guard.out);

  // 행렬
  cells += canI('platform-viewer', person('viewer', GROUPS.viewer), [
    ['get', 'pods', true], ['get', 'pods/log', true], ['list', 'deployments', true], ['list', 'horizontalpodautoscalers', true], ['list', 'cronjobs', true],
    ['get', 'secrets', false], ['list', 'secrets', false], ['get', 'configmaps', false], ['patch', 'deployments', false], ['delete', 'pods', false],
    ['list', 'roles', false], ...NEVER,
  ]);
  cells += canI('sre-operator', person('sre', GROUPS.sre), [
    ['patch', 'deployments', true], ['update', 'deployments/scale', true], ['get', 'pods/log', true], ['list', 'events', true], ['list', 'jobs', true],
    ['get', 'secrets', false], ['list', 'secrets', false], ['create', 'deployments', false], ['delete', 'deployments', false], ['delete', 'pods', false],
    ['patch', 'roles', false], ['create', 'pods/portforward', false], ...NEVER,
  ]);
  cells += canI('security-auditor', person('auditor', GROUPS.auditor), [
    ['list', 'roles', true], ['list', 'rolebindings', true], ['list', 'networkpolicies', true], ['list', 'serviceaccounts', true], ['get', 'deployments', true],
    ['list', 'poddisruptionbudgets', true], ['list', 'events', true],
    ['get', 'secrets', false], ['list', 'secrets', false], ['patch', 'deployments', false], ['delete', 'networkpolicies', false], ['patch', 'roles', false],
    ['update', 'deployments/scale', false], ...NEVER,
  ]);
  cells += canI('admission-admin (Kubernetes 권한 없음)', person('admission-admin', GROUPS.admin), [
    ['get', 'pods', false], ['list', 'deployments', false], ['get', 'pods/log', false], ['get', 'secrets', false], ['get', 'configmaps', false],
    ['list', 'events', false], ['list', 'roles', false], ['patch', 'deployments', false], ...NEVER,
  ]);
  const bgRows = [['get', 'secrets', false], ['patch', 'deployments', false], ['get', 'pods', false], ['update', 'configmaps', false], ...NEVER];
  cells += canI('break-glass — 평소(바인딩 없음)', person('oncall', GROUPS.breakGlass), bgRows);

  // sre-operator 의 Deployment 수정 — 승인 정책
  const sre = person('sre', GROUPS.sre);
  let restart = null;
  for (let i = 0; i < 10; i++) {
    // 정책이 막 적용됐으면 반영에 몇 초 걸린다 — 막혀야 할 요청이 막힐 때까지 기다린다
    // Secret 을 읽지 않고 참조만 넣는다 — 이것이 실제 공격 경로다(Pod 가 대신 읽고 로그로 내보낸다)
    const probe = kubectl(['patch', 'deployment', 'guard-probe', '-n', NS, '-p',
      '{"spec":{"template":{"spec":{"containers":[{"name":"pause","env":[{"name":"TOKEN","valueFrom":{"secretKeyRef":{"name":"probe-secret","key":"token"}}}]}]}}}}'], { as: sre });
    if (!probe.ok) {
      check(/Pod 구성/.test(probe.out), 'sre-operator: Secret 참조를 환경변수로 넣는 수정은 승인 정책이 거절', probe.out.split('\n').pop().slice(0, 160));
      break;
    }
    if (i === 9) check(false, 'sre-operator: Secret 참조를 환경변수로 넣는 수정은 승인 정책이 거절', probe.out);
    kubectl(['set', 'env', 'deployment/guard-probe', '-n', NS, 'TOKEN-']); // 들어갔으면 되돌리고 다시
    await new Promise((r) => setTimeout(r, 1000));
  }
  const img = kubectl(['set', 'image', 'deployment/guard-probe', '-n', NS, 'pause=registry.k8s.io/pause:3.9'], { as: sre });
  check(!img.ok && /Pod 구성/.test(img.out), 'sre-operator: 이미지 변경은 거절');
  const label = kubectl(['patch', 'deployment', 'guard-probe', '-n', NS, '--type=merge', '-p', '{"spec":{"template":{"metadata":{"labels":{"extra":"x"}}}}}'], { as: sre });
  check(!label.ok && /라벨/.test(label.out), 'sre-operator: Pod 라벨 변경은 거절');
  const ann = kubectl(['patch', 'deployment', 'guard-probe', '-n', NS, '--type=merge', '-p', '{"spec":{"template":{"metadata":{"annotations":{"other":"x"}}}}}'], { as: sre });
  check(!ann.ok && /annotation/.test(ann.out), 'sre-operator: 재시작 표시 말고 다른 annotation 은 거절');
  restart = kubectl(['rollout', 'restart', 'deployment/guard-probe', '-n', NS], { as: sre });
  check(restart.ok, 'sre-operator: 재시작(rollout restart)은 된다', restart.ok ? undefined : restart.out);
  const scale = kubectl(['scale', 'deployment/guard-probe', '-n', NS, '--replicas=0'], { as: sre });
  check(scale.ok, 'sre-operator: 규모 조정(scale)은 된다', scale.ok ? undefined : scale.out);
  const replicas = kubectl(['patch', 'deployment', 'guard-probe', '-n', NS, '--type=merge', '-p', '{"spec":{"replicas":0}}'], { as: sre });
  check(replicas.ok, 'sre-operator: replicas 만 바꾸는 patch 는 된다', replicas.ok ? undefined : replicas.out);
  const adminEnv = kubectl(['set', 'env', 'deployment/guard-probe', '-n', NS, 'PLATFORM_CHANGE=1']);
  check(adminEnv.ok, '승인 정책은 sre 그룹에만 걸린다 — 플랫폼 관리자의 같은 수정은 된다', adminEnv.ok ? undefined : adminEnv.out);

  // break-glass 켜기 → 끄기
  const noReason = spawnSync('helm', ['template', RELEASE, path.join(ROOT, 'deploy/charts/k-admission'), '--show-only', 'templates/rbac.yaml',
    '-f', path.join(ROOT, 'deploy/charts/k-admission/values.yaml'), '-f', path.join(ROOT, 'deploy/charts/k-admission/values-m.yaml'),
    '--set', `api.image.digest=${DIGEST}`, '--set', `eventRelay.image.digest=${DIGEST}`, '--set', `documentService.image.digest=${DIGEST}`,
    '--set', `database.pooler.image.digest=${DIGEST}`, '--set', 'documentService.scannerEngine=x', '--set', 'runtimeSecret.name=r',
    '--set', `rbac.breakGlass.group=${GROUPS.breakGlass}`], { encoding: 'utf8' });
  check(noReason.status !== 0 && /expiresAt/.test(noReason.stderr), 'break-glass 는 끝나는 시각·사유 없이 켤 수 없다(렌더링 거부)');
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const on = kubectl(['apply', '-n', NS, '-f', '-'], {
    input: renderRbac(NS, ['--set', `rbac.breakGlass.group=${GROUPS.breakGlass}`, '--set', `rbac.breakGlass.expiresAt=${expiresAt}`, '--set', 'rbac.breakGlass.reason=RBAC 시험 — 비상 역할 켜기']),
  });
  const binding = kubectl(['get', 'rolebinding', `${RELEASE}-break-glass`, '-n', NS, '-o', 'jsonpath={.metadata.annotations.kadmission\\.kr/break-glass-expires-at}']);
  check(on.ok && binding.out === expiresAt, 'break-glass 켜기 — 바인딩에 끝나는 시각이 붙는다', binding.out);
  cells += canI('break-glass — 켠 동안', person('oncall', GROUPS.breakGlass), [
    ['get', 'secrets', true], ['update', 'secrets', true], ['patch', 'deployments', true], ['delete', 'jobs', true], ['update', 'configmaps', true],
    ['patch', 'networkpolicies', true], ['get', 'pods/log', true],
    ['delete', 'pods', false], ['patch', 'roles', false], ...NEVER,
  ]);
  kubectl(['delete', 'rolebinding', `${RELEASE}-break-glass`, '-n', NS]);
  cells += canI('break-glass — 끈 뒤', person('oncall', GROUPS.breakGlass), bgRows);

  // 배포 계정 — 차트 RBAC 을 실제 배포 네임스페이스에 만들 수 있나(권한 상승 방지 검사를 통과하나), 범위 밖은 못 하나
  const twinNs = `${NS}-deploy`;
  kubectl(['delete', 'namespace', twinNs, '--wait=true', '--ignore-not-found']);
  kubectl(['create', 'namespace', twinNs]);
  const twinRbac = readFileSync(path.join(ROOT, 'deploy/gitops/base/reconciler-rbac.yaml'), 'utf8').replaceAll(`namespace: ${APP_NS}`, `namespace: ${twinNs}`);
  const twin = kubectl(['apply', '-f', '-'], { input: twinRbac });
  const asTwin = { user: `system:serviceaccount:${twinNs}:release-controller` };
  const real = kubectl(['apply', '-n', twinNs, '-f', '-'], { input: renderRbac(twinNs), as: asTwin });
  check(twin.ok && real.ok, '배포 계정과 같은 권한으로 차트 RBAC(Role 5·바인딩 4)을 실제로 만든다 — 권한 상승 검사 통과', real.ok ? undefined : real.out.slice(-400));
  kubectl(['delete', 'namespace', twinNs, '--wait=false']);

  const rc = { user: `system:serviceaccount:${APP_NS}:release-controller` };
  if (kubectl(['get', 'serviceaccount', 'release-controller', '-n', APP_NS]).ok) {
    cells += canI('배포 계정 — 배포 네임스페이스', rc, [
      ['patch', 'deployments', true], ['create', 'roles', true], ['create', 'rolebindings', true], ['create', 'helmreleases', true],
      ['create', 'pods/exec', false], ['escalate', 'roles', false],
    ], APP_NS);
    cells += canI('배포 계정 — 다른 네임스페이스·클러스터 범위', rc, [
      ['patch', 'deployments', false], ['get', 'secrets', false], ['create', 'roles', false],
      ['create', 'clusterroles', false], ['create', 'clusterrolebindings', false], ['create', 'namespaces', false],
      ['create', 'validatingadmissionpolicies', false], ['delete', 'validatingadmissionpolicybindings', false],
    ]);
  } else {
    check(false, `배포 계정(${APP_NS}/release-controller)이 없다 — GitOps 로컬 부트스트랩(deploy/gitops/local) 뒤에 돌린다`);
  }
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  kubectl(['delete', 'namespace', NS, '--wait=false', '--ignore-not-found']);
}

const result = {
  test: 'Kubernetes 역할 6종 — 역할별 허용·거절 행렬·sre 수정 범위·break-glass 켜고 끄기 (T-M5-02 단계 8, D-68)',
  environment: `축소 환경 — 로컬 kind(${CONTEXT}), 사람 역할은 kubectl 흉내(--as/--as-group)`,
  at: new Date(started).toISOString(),
  durationSec: Math.round((Date.now() - started) / 1000),
  cells,
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `k8s-rbac-kind-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} Kubernetes 역할 시험 — 행렬 ${cells}칸, 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
