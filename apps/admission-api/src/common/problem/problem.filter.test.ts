import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransientDbSaturation } from './problem.filter';

describe('DB 연결 풀 포화는 재시도 안내(503)로 (T-M4-40 kind 시험에서 발견)', () => {
  it('pg-pool 연결 대기 초과·PgBouncer·PostgreSQL 연결 상한을 알아본다', () => {
    assert.equal(isTransientDbSaturation(new Error('timeout exceeded when trying to connect')), true);
    assert.equal(isTransientDbSaturation(new Error('no more connections allowed (max_client_conn)')), true);
    assert.equal(isTransientDbSaturation(new Error('sorry, too many clients already')), true);
    assert.equal(isTransientDbSaturation(new Error('Query read timeout')), true, '노드 장애로 매달린 연결 (T-M4-39)');
    assert.equal(isTransientDbSaturation(new Error('Connection terminated unexpectedly')), true);
  });

  it('다른 오류는 그대로 500 이다 — 제약 위반·문법 오류를 재시도로 덮지 않는다', () => {
    assert.equal(isTransientDbSaturation(new Error('duplicate key value violates unique constraint')), false);
    assert.equal(isTransientDbSaturation('timeout exceeded when trying to connect'), false);
    assert.equal(isTransientDbSaturation(undefined), false);
  });
});
