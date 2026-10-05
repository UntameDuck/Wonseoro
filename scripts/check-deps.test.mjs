import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkPackage, workspaceRoots } from './check-deps.mjs';

function fixture({ packageJson = {}, sources, rootSources = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'wonseoro-check-deps-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: '@wonseoro/fixture', ...packageJson }, null, 2)}\n`,
  );
  for (const [name, source] of Object.entries(sources)) writeFileSync(join(root, 'src', name), source);
  for (const [name, source] of Object.entries(rootSources)) writeFileSync(join(root, name), source);
  return root;
}

function withFixture(options, assertion) {
  const root = fixture(options);
  try {
    assertion(checkPackage(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('운영 코드가 devDependency에만 둔 패키지를 쓰면 실패한다', () => {
  withFixture(
    {
      packageJson: { devDependencies: { fastify: '1.0.0' } },
      sources: { 'main.ts': "import fastify from 'fastify';\n" },
    },
    (result) => assert.deepEqual(result.missingRuntime, ['fastify']),
  );
});

test('시험 코드의 직접 의존성이 선언되지 않으면 실패한다', () => {
  withFixture(
    { sources: { 'schema.test.ts': "import Ajv2020 from 'ajv/dist/2020';\n" } },
    (result) => assert.deepEqual(result.missingBuildAndTest, ['ajv']),
  );
});

test('시험 코드의 직접 의존성은 devDependency로 선언할 수 있다', () => {
  withFixture(
    {
      packageJson: { devDependencies: { ajv: '8.20.0' } },
      sources: { 'schema.test.ts': "import Ajv2020 from 'ajv/dist/2020';\n" },
    },
    (result) => {
      assert.deepEqual(result.missingRuntime, []);
      assert.deepEqual(result.missingBuildAndTest, []);
    },
  );
});

test('운영 코드의 type import도 빌드 의존성 선언을 요구한다', () => {
  withFixture(
    { sources: { 'types.ts': "import type { FastifyRequest } from 'fastify';\n" } },
    (result) => {
      assert.deepEqual(result.missingRuntime, []);
      assert.deepEqual(result.missingBuildAndTest, ['fastify']);
    },
  );
});

test('루트 workspaces에서 다음 검사 대상을 자동으로 찾는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wonseoro-check-deps-workspaces-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"workspaces":["apps/*","packages/*"]}\n');
    for (const path of ['apps/api', 'packages/ui']) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, 'package.json'), '{}\n');
    }
    assert.deepEqual(
      workspaceRoots(root).map((path) => path.slice(root.length + 1).replaceAll('\\', '/')),
      ['apps/api', 'packages/ui'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('워크스페이스 최상위 설정 파일의 직접 의존성도 검사한다', () => {
  withFixture(
    {
      sources: {},
      rootSources: { 'eslint.config.mjs': "import js from '@eslint/js';\nexport default [js.configs.recommended];\n" },
    },
    (result) => assert.deepEqual(result.missingBuildAndTest, ['@eslint/js']),
  );
});
