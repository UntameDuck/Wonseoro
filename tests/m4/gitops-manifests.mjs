import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments, parse } from 'yaml';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const docs = (path) => parseAllDocuments(read(path)).map((document) => document.toJSON());

const universities = [
  ['UNIV-A', 'univ-a', 'values-m.yaml'],
  ['UNIV-B', 'univ-b', 'values-s.yaml'],
  ['UNIV-C', 'univ-c', 'values-l.yaml'],
];

for (const [universityId, slug, profile] of universities) {
  const [source, sync] = docs(`deploy/gitops/bootstrap/${universityId}.yaml`);
  assert.equal(source.kind, 'GitRepository');
  assert.equal(source.spec.url, 'https://github.com/UntameDuck/Wonseoro.git');
  assert.equal(source.spec.ref.branch, 'main');
  assert.equal(source.spec.verify.mode, 'HEAD');
  assert.equal(source.spec.verify.secretRef.name, 'wonseoro-git-authors');

  assert.equal(sync.kind, 'Kustomization');
  assert.equal(sync.spec.path, `./deploy/gitops/clusters/${slug}`);
  assert.equal(sync.spec.prune, true);
  assert.equal(sync.spec.serviceAccountName, 'release-controller');

  const release = parse(read(`deploy/gitops/clusters/${slug}/release.yaml`));
  assert.equal(release.kind, 'HelmRelease');
  assert.equal(release.metadata.namespace, 'kadmission-app');
  assert.equal(release.spec.serviceAccountName, 'release-controller');
  assert.equal(release.spec.chart.spec.reconcileStrategy, 'Revision');
  assert.equal(release.spec.driftDetection.mode, 'enabled');
  assert.equal(release.spec.kubeConfig, undefined);
  assert.deepEqual(release.spec.chart.spec.valuesFiles, [
    'deploy/charts/k-admission/values.yaml',
    `deploy/charts/k-admission/${profile}`,
    `deploy/universities/${universityId}/values.yaml`,
    // 예약 자동화가 만든 Peak Mode overlay 는 반드시 마지막 — 다른 values 가 덮지 못한다 (D-48)
    `deploy/universities/${universityId}/peak-mode.yaml`,
  ]);
}

const rbac = docs('deploy/gitops/base/reconciler-rbac.yaml');
assert.deepEqual(rbac.map((item) => item.kind), ['ServiceAccount', 'Role', 'RoleBinding']);
const role = rbac.find((item) => item.kind === 'Role');
assert.equal(role.metadata.namespace, 'kadmission-app');
assert.equal(role.rules.some((rule) => rule.resources?.includes('namespaces')), false);
assert.equal(role.rules.some((rule) => rule.resources?.includes('clusterroles')), false);
assert.match(
  read('deploy/charts/k-admission/templates/_helpers.tpl'),
  /replace \"\+\" \"_\"/,
);

const chartRbac = read('deploy/charts/k-admission/templates/rbac.yaml');
assert.equal(chartRbac.includes('apiGroups: ["", "apps", "batch", "autoscaling"]'), false);

const local = docs('deploy/gitops/local/bootstrap-univ-a.yaml');
assert.equal(local[0].spec.verify.mode, 'HEAD');
assert.equal(local[1].spec.path, './deploy/gitops/local/univ-a');
const localRelease = parse(read('deploy/gitops/local/univ-a/release.yaml'));
assert.deepEqual(localRelease.spec.chart.spec.valuesFiles, [
  'deploy/charts/k-admission/values.yaml',
  'deploy/charts/k-admission/values-s.yaml',
  'deploy/local/values-local.yaml',
  'deploy/local/values-univ-a.yaml',
  'deploy/local/peak-mode-univ-a.yaml',
]);

for (const path of [
  'deploy/gitops/bootstrap/UNIV-A.yaml',
  'deploy/gitops/bootstrap/UNIV-B.yaml',
  'deploy/gitops/bootstrap/UNIV-C.yaml',
  'deploy/gitops/local/bootstrap-univ-a.yaml',
]) {
  assert.equal(docs(path).some((document) => document.kind === 'Secret'), false);
}

console.log('gitops manifests: 대학 3곳 signed HEAD 검증·namespace 한정 권한·Flux HelmRelease 확인');
