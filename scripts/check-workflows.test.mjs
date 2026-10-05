import assert from 'node:assert/strict';
import test from 'node:test';
import { localNodeTargetsIn, npmRunsIn, npmScriptsIn, validateWorkflow } from './check-workflows.mjs';

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
  assert.deepEqual(localNodeTargetsIn('node scripts/a.mjs && node --test scripts/b.test.mjs'), ['scripts/a.mjs']);
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

test('없는 Node 실행 파일을 거절한다', () => {
  const source = valid.replace('npm run check:one && npm run check:two -- --flag', 'node scripts/does-not-exist.mjs');
  const catalog = { root: {}, workspaces: new Map() };
  assert.throws(() => validateWorkflow(source, catalog), /없는 Node 실행 파일/);
});

test('중복 키와 버전 없는 action을 거절한다', () => {
  const catalog = { root: {}, workspaces: new Map() };
  assert.throws(() => validateWorkflow('name: A\nname: B\non: push\njobs: {}', catalog), /Map keys must be unique/);
  assert.throws(
    () => validateWorkflow('name: A\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout', catalog),
    /uses에 버전이 없습니다/,
  );
});
