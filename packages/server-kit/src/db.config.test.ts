import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DB_POOL_BUDGET, databaseConnectionString, poolBudgetFor } from './db.config';

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

describe('DB Pooler 목적지 override (T-M4-09)', () => {
  const direct = 'postgresql://app:p%40ss@db.internal:5432/admission?sslmode=require';

  it('override가 없으면 Vault의 URL을 그대로 쓴다', () => {
    assert.equal(databaseConnectionString({ DATABASE_URL: direct }), direct);
  });

  it('자격증명·DB명·쿼리는 유지하고 host·port만 Pooler로 바꾼다', () => {
    const changed = databaseConnectionString({
      DATABASE_URL: direct,
      DB_PROXY_HOST: 'univ-a-pgbouncer',
      DB_PROXY_PORT: '6432',
    });
    const url = new URL(changed!);
    assert.equal(url.username, 'app');
    assert.equal(url.password, 'p%40ss');
    assert.equal(url.hostname, 'univ-a-pgbouncer');
    assert.equal(url.port, '6432');
    assert.equal(url.pathname, '/admission');
    assert.equal(url.searchParams.get('sslmode'), 'require');
  });

  it('DB와 Pooler의 TLS 경계를 분리한다', () => {
    const changed = databaseConnectionString({
      DATABASE_URL: 'postgresql://app:secret@db.internal/admission?sslmode=verify-full&application_name=api',
      DB_PROXY_HOST: 'univ-a-pgbouncer',
      DB_PROXY_PORT: '6432',
      DB_PROXY_SSLMODE: 'disable',
    });
    const url = new URL(changed!);
    assert.equal(url.searchParams.get('sslmode'), 'disable');
    assert.equal(url.searchParams.get('application_name'), 'api');
    assert.throws(() => databaseConnectionString({
      DATABASE_URL: direct,
      DB_PROXY_HOST: 'pooler',
      DB_PROXY_PORT: '6432',
      DB_PROXY_SSLMODE: 'unsafe',
    }));
  });

  it('host·port 일부만 있거나 포트가 잘못되면 기동을 막는다', () => {
    assert.throws(() => databaseConnectionString({ DATABASE_URL: direct, DB_PROXY_HOST: 'pooler' }));
    assert.throws(() => databaseConnectionString({ DATABASE_URL: direct, DB_PROXY_PORT: '6432' }));
    assert.throws(() => databaseConnectionString({ DATABASE_URL: direct, DB_PROXY_HOST: 'pooler', DB_PROXY_PORT: '0' }));
  });
});

describe('끊긴 연결 판별 (T-M4-39)', () => {
  it('쿼리 시간 초과·연결 종료·소켓 오류는 버릴 연결이고, 업무 오류는 아니다', async () => {
    const { isBrokenConnection } = await import('./db.module');
    assert.equal(isBrokenConnection(new Error('Query read timeout')), true);
    assert.equal(isBrokenConnection(new Error('Connection terminated unexpectedly')), true);
    assert.equal(isBrokenConnection(Object.assign(new Error('read'), { code: 'ECONNRESET' })), true);
    assert.equal(isBrokenConnection(new Error('duplicate key value violates unique constraint')), false);
    assert.equal(isBrokenConnection('Query read timeout'), false);
  });

  it('모든 서비스 예산에 쿼리 시간 상한이 있다', () => {
    for (const [service, budget] of Object.entries(DB_POOL_BUDGET)) {
      assert.ok(budget.queryTimeoutMs > 0, service);
    }
  });
});
