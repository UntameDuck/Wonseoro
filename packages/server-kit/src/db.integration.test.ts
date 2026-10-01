import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from './db.module';

/**
 * 빌려 쓰는 연결이 끊겨도 프로세스가 죽지 않는다 (D-63).
 *
 * pg 풀은 쉬고 있는 연결에만 오류 처리기를 붙인다. 트랜잭션이 연결을 빌려 쓰는 동안 DB 가 연결을 끊으면
 * (DB 재시작·장애 전환·관리자 종료) 그 연결의 'error' 이벤트를 받을 곳이 없어 Node 프로세스가 통째로 죽었다 —
 * 화면 캡처 준비 중 DB 를 다시 만들 때 event-relay 가 이렇게 죽었다. 트랜잭션은 실패해도 프로세스는 살아야 한다.
 */
let db: Db;
let available = false;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('event-relay', 'public');
  available = await db.healthy();
});

after(async () => {
  if (available) await db.onApplicationShutdown();
});

describe('Db — 빌린 연결이 끊길 때 (D-63)', () => {
  it('트랜잭션 중 연결이 끊기면 트랜잭션만 실패하고 프로세스는 산다', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const crashed: unknown[] = [];
    const onUncaught = (err: unknown) => crashed.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL });
      await admin.connect();
      try {
        const result = db.tx(async (client) => {
          const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          // 이 연결을 다른 세션이 끊는다 — 트랜잭션은 쿼리를 기다리지 않고 쉬는 중이다
          await admin.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
          await new Promise((r) => setTimeout(r, 300));
          await client.query('SELECT 1');
        });
        await assert.rejects(result);
      } finally {
        await admin.end();
      }
      await new Promise((r) => setTimeout(r, 200));
      assert.deepEqual(crashed, [], '처리되지 않은 연결 오류로 프로세스가 죽으면 안 된다');
      assert.equal(await db.healthy(), true, '풀은 새 연결로 계속 일한다');
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
