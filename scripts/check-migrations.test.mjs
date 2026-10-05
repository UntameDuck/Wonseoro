import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMigrationSequence } from './check-migrations.mjs';

const expectedPaths = ['migrations/0001_init.sql', 'migrations/0002_roles.sql', 'migrations/0003_feature.sql'];

test('모든 마이그레이션이 순서대로 있으면 통과한다', () => {
  const text = `${expectedPaths.join(' ')}\n${expectedPaths.join(' ')}`;
  assert.doesNotThrow(() => assertMigrationSequence({ label: '시험', text, expectedPaths, runs: 2 }));
});

test('마이그레이션 하나가 빠지면 해당 파일을 알린다', () => {
  const text = 'migrations/0001_init.sql migrations/0003_feature.sql';
  assert.throws(
    () => assertMigrationSequence({ label: '시험', text, expectedPaths }),
    /빠진 마이그레이션 migrations\/0002_roles\.sql/,
  );
});

test('마이그레이션 적용 순서가 바뀌면 실패한다', () => {
  const text = 'migrations/0002_roles.sql migrations/0001_init.sql migrations/0003_feature.sql';
  assert.throws(() => assertMigrationSequence({ label: '시험', text, expectedPaths }), /적용 순서가 뒤섞였습니다/);
});
