import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { LEADER_LOCK_CLASS, withLeaderLock } from './leader-lock';

/**
 * 리더 잠금 회귀 시험 (D-54). 세션 잠금은 PgBouncer transaction 풀에서 서버 연결에 새어 남았다.
 * 여기서는 PgBouncer 없이도 확인할 수 있는 성질을 본다 — 작업이 끝나면(성공·실패 모두) 잠금이 하나도 남지 않고,
 * 쥐고 있는 동안에는 다른 호출이 들어오지 못한다.
 */
let db: Db;
let available = false;

const heldLeaderLocks = async (): Promise<number> => {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1`,
    [LEADER_LOCK_CLASS],
  );
  return Number(rows[0]?.n ?? 0);
};

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (available) await db.onApplicationShutdown();
});

describe('withLeaderLock (D-54)', () => {
  it('작업이 끝나면 잠금이 남지 않는다 — 성공·실패 모두', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const name = `test:leader:${Date.now()}`;
    assert.equal(await withLeaderLock(db, name, async () => heldLeaderLocks()), 1, '작업 중에는 잠금이 하나 있다');
    assert.equal(await heldLeaderLocks(), 0);
    await assert.rejects(withLeaderLock(db, name, async () => { throw new Error('작업 실패'); }), /작업 실패/);
    assert.equal(await heldLeaderLocks(), 0, '작업이 실패해도 잠금이 풀린다');
    assert.equal(await withLeaderLock(db, name, async () => 'again'), 'again', '다음 주기가 다시 잡는다');
  });

  it('쥐고 있는 동안 다른 호출은 작업을 부르지 않는다', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const name = `test:leader:${Date.now()}:busy`;
    let inner: unknown = 'not-called';
    const outer = await withLeaderLock(db, name, async () => {
      inner = await withLeaderLock(db, name, async () => 'ran');
      return 'outer';
    });
    assert.equal(outer, 'outer');
    assert.equal(inner, null, '두 번째 호출은 잠금을 못 잡고 null');
  });

  it('DB 가 유휴 트랜잭션을 끊게 해 둬도 긴 작업 중 잠금이 풀리지 않는다 (D-93)', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    // 이 Db 의 연결은 모두 1초 넘게 idle in transaction 이면 끊긴다(운영 DB 의 흔한 설정을 흉내)
    const strict = new Db('admission-api', 'kadmission');
    strict.pool.on('connect', (c) => void c.query(`SET idle_in_transaction_session_timeout = 1000`));
    try {
      const name = `test:leader:${Date.now()}:idle`;
      let second: unknown = 'not-called';
      const outer = await withLeaderLock(strict, name, async () => {
        await new Promise((r) => setTimeout(r, 2500));
        // 잠금 연결이 끊겼다면 이 시점에 다른 Pod 가 잡을 수 있다
        second = await withLeaderLock(db, name, async () => 'second');
        return 'outer';
      });
      assert.equal(outer, 'outer');
      assert.equal(second, null, '2.5초 작업 뒤에도 잠금은 그대로');
    } finally {
      await strict.onApplicationShutdown();
    }
  });
});
