import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localNodeTargetsIn,
  localShellTargetsIn,
  npmRunsIn,
  npmScriptsIn,
  validatePackageScriptTargets,
  validateWorkflow,
} from './check-workflows.mjs';

const valid = `name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run check:one && npm run check:two -- --flag
`;

test('run 명령에서 npm script 이름을 읽는다', () => {
  assert.deepEqual(npmScriptsIn('npm run check:a && npm run test:b -- --flag'), ['check:a', 'test:b']);
  assert.deepEqual(npmRunsIn('npm run build -w @wonseoro/a -w @wonseoro/b'), [{
    script: 'build',
    workspaces: ['@wonseoro/a', '@wonseoro/b'],
  }]);
  assert.deepEqual(localNodeTargetsIn('node scripts/a.mjs && node --test --test-concurrency=1 scripts/b.test.mjs'), ['scripts/a.mjs', 'scripts/b.test.mjs']);
  assert.deepEqual(localShellTargetsIn('bash scripts/a.sh && sh ./scripts/b.sh'), ['scripts/a.sh', './scripts/b.sh']);
});

test('정상 워크플로의 잡과 단계를 센다', () => {
  const catalog = { root: { 'check:one': 'x', 'check:two': 'y' }, workspaces: new Map() };
  assert.deepEqual(validateWorkflow(valid, catalog), { jobs: 1, steps: 2 });
});

test('없는 npm script 호출을 거절한다', () => {
  const catalog = { root: { 'check:one': 'x' }, workspaces: new Map() };
  assert.throws(() => validateWorkflow(valid, catalog), /루트에 없는 npm script 'check:two'/);
});

test('없는 워크스페이스와 그 안에 없는 script를 거절한다', () => {
  const source = valid.replace('npm run check:one && npm run check:two -- --flag', 'npm run build -w @wonseoro/api');
  const empty = { root: {}, workspaces: new Map() };
  assert.throws(() => validateWorkflow(source, empty), /없는 워크스페이스 '@wonseoro\/api'/);
  const catalog = { root: {}, workspaces: new Map([['@wonseoro/api', { test: 'node --test' }]]) };
  assert.throws(() => validateWorkflow(source, catalog), /@wonseoro\/api에 없는 npm script 'build'/);
});

test('없는 Node·셸 실행 파일을 거절한다', () => {
  const source = valid.replace('npm run check:one && npm run check:two -- --flag', 'node scripts/does-not-exist.mjs');
  const catalog = { root: {}, workspaces: new Map() };
  assert.throws(() => validateWorkflow(source, catalog), /없는 로컬 실행 파일/);
  assert.throws(() => validateWorkflow(source.replace('node scripts/does-not-exist.mjs', 'node --test scripts/does-not-exist.test.mjs'), catalog), /없는 로컬 실행 파일/);
  assert.throws(() => validateWorkflow(source.replace('node scripts/does-not-exist.mjs', 'bash scripts/does-not-exist.sh'), catalog), /없는 로컬 실행 파일/);
});

test('없는 작업 폴더와 로컬 action을 거절한다', () => {
  const catalog = { root: {}, workspaces: new Map() };
  const directory = valid.replace('npm run check:one && npm run check:two -- --flag', 'echo ok\n        working-directory: missing-directory');
  assert.throws(() => validateWorkflow(directory, catalog), /working-directory 'missing-directory'가 없습니다/);
  const action = valid.replace('uses: actions/checkout@v4', 'uses: ./missing-action');
  assert.throws(() => validateWorkflow(action, catalog), /로컬 참조 '.\/missing-action'가 없습니다/);
});

test('재사용 잡의 버전과 로컬 파일을 검사한다', () => {
  const catalog = { root: {}, workspaces: new Map() };
  const external = 'name: A\non: push\njobs:\n  call:\n    uses: owner/repository/.github/workflows/ci.yml';
  assert.throws(() => validateWorkflow(external, catalog), /재사용 잡 uses에 버전이 없습니다/);
  const local = external.replace('owner/repository/.github/workflows/ci.yml', './.github/workflows/missing.yml');
  assert.throws(() => validateWorkflow(local, catalog), /로컬 참조 '.\/.github\/workflows\/missing.yml'가 없습니다/);
});

test('package script의 소스 실행 파일을 검사하고 생성물은 제외한다', () => {
  assert.deepEqual(validatePackageScriptTargets([{
    label: 'root',
    base: process.cwd(),
    scripts: {
      check: 'node scripts/check-workflows.mjs',
      sourceGlob: 'node --test "scripts/*.test.mjs"',
      generated: 'node dist/main.js',
      generatedGlob: 'node --test "dist/**/*.test.js"',
    },
  }]), { checked: 2, skippedGenerated: 2 });
  assert.throws(() => validatePackageScriptTargets([{
    label: 'root', base: process.cwd(), scripts: { broken: 'node scripts/missing.mjs' },
  }]), /root의 'broken'/);
  assert.throws(() => validatePackageScriptTargets([{
    label: 'root', base: process.cwd(), scripts: { broken: 'node --test "missing/**/*.test.mjs"' },
  }]), /없는 glob 기준 폴더/);
});

test('중복 키와 버전 없는 action을 거절한다', () => {
  const catalog = { root: {}, workspaces: new Map() };
  assert.throws(() => validateWorkflow('name: A\nname: B\non: push\njobs: {}', catalog), /Map keys must be unique/);
  assert.throws(
    () => validateWorkflow('name: A\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout', catalog),
    /uses에 버전이 없습니다/,
  );
});
