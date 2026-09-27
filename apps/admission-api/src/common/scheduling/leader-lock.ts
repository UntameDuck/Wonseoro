import { Db } from '@wonseoro/server-kit';

/**
 * 여러 Pod 중 하나만 이 작업을 돌게 한다. 잡지 못하면 `fn` 을 부르지 않고 null.
 *
 * 트랜잭션 잠금(`pg_advisory_xact_lock`)이 아니라 **세션 잠금**이다. 안에서 PG·중앙을
 * 부르는 작업이 많다 — 그 동안 트랜잭션을 열어 두면 idle-in-transaction 이 되고
 * 락 유지 시간이 외부 지연에 묶인다 (§B3). 세션 잠금은 연결 하나만 붙잡는다.
 * Pod 가 죽으면 연결이 끊기면서 잠금도 풀린다 — 남는 잠금이 없다.
 */
export async function withLeaderLock<T>(
  db: Db,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = await db.pool.connect();
  let held = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS ok`,
      [name],
    );
    held = rows[0]?.ok === true;
    if (!held) return null;
    return await fn();
  } finally {
    if (held) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]).catch(() => undefined);
    client.release();
  }
}
