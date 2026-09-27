import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { poolBudgetFor } from './db.config';

describe('DB pool 예산 (§B2, T-M4-09)', () => {
  afterEach(() => {
    delete process.env.DB_POOL_MAX;
  });

  it('설정이 없으면 서비스별 기본 예산을 쓴다', () => {
    assert.equal(poolBudgetFor('admission-api').max, 10);
    assert.equal(poolBudgetFor('event-relay').max, 3);
  });

  it('배포가 Pod 당 상한을 정할 수 있다 — 나머지 값은 그대로', () => {
    process.env.DB_POOL_MAX = '40';
    const b = poolBudgetFor('admission-api');
    assert.equal(b.max, 40);
    assert.equal(b.acquireTimeoutMs, 3_000);
  });

  it('잘못된 값은 기동에서 막는다 — 조용히 기본값으로 떨어지지 않는다', () => {
    for (const v of ['0', '-1', '1.5', 'many', '501']) {
      process.env.DB_POOL_MAX = v;
      assert.throws(() => poolBudgetFor('admission-api'), /DB_POOL_MAX/);
    }
  });
});
