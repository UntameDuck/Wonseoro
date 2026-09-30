import { Db } from '@wonseoro/server-kit';

/**
 * 잠금 이름 공간. 두 정수 키 `(LEADER_LOCK_CLASS, hashtext(name))` 는 한 정수 키(bigint)와 다른 공간이다 —
 * 예전 세션 잠금(`pg_try_advisory_lock(hashtext(name))`)이 새어 남아 있어도 새 잠금을 막지 못한다. (D-54)
 */
export const LEADER_LOCK_CLASS = 0x4b41; // 'KA'

/**
 * 여러 Pod 중 하나만 이 작업을 돌게 한다. 잡지 못하면 `fn` 을 부르지 않고 null.
 *
 * **트랜잭션 잠금이다** (`pg_try_advisory_xact_lock`) — 잠금 전용 연결 하나에서 트랜잭션을 열고 잠근 뒤,
 * `fn` 이 끝나면 COMMIT 으로 푼다. `fn` 은 다른 연결로 일한다.
 *
 * 세션 잠금(`pg_try_advisory_lock`)을 쓰면 안 된다 (D-54). DB 앞에 PgBouncer transaction 풀이 있으면
 * 문장마다 다른 서버 연결로 갈 수 있어, 잠근 연결과 푸는 연결이 달라진다. 풀리지 않은 잠금은 그 서버 연결에
 * 남고, 이후로는 우연히 그 연결에 닿은 주기만 돈다(결제 재확인이 3분씩 멈췄다). 세션 잠금은 같은 세션에서
 * 다시 잡히므로 두 Pod 가 동시에 도는 일도 생긴다. 트랜잭션 잠금은 트랜잭션이 끝나면 반드시 풀리고,
 * transaction 풀은 트랜잭션 동안 서버 연결을 바꾸지 않는다.
 *
 * 비용: 잠금 연결이 작업 동안 idle in transaction 으로 남는다. 이 트랜잭션은 행을 잠그지 않고,
 * READ COMMITTED 라 문장이 끝나면 스냅샷도 놓아 VACUUM 을 막지 않는다 — 세션 잠금 때와 같이 연결 하나를 쓸 뿐이다 (§B3).
 */
export async function withLeaderLock<T>(
  db: Db,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = await db.pool.connect();
  let broken: Error | undefined;
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok`,
      [LEADER_LOCK_CLASS, name],
    );
    if (rows[0]?.ok !== true) return null;
    return await fn();
  } catch (err) {
    broken = err as Error;
    throw err;
  } finally {
    if (open) {
      try {
        await client.query('COMMIT');
        broken = undefined; // fn 이 실패해도 잠금 연결 자체는 멀쩡하다
      } catch (err) {
        broken = err as Error; // 연결이 끊겼다 — 풀에 돌려보내지 않고 버린다
      }
    }
    client.release(broken);
  }
}
