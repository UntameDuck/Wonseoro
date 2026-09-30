/**
 * 풀(Db)과 트랜잭션 커넥션(PoolClient) 어느 쪽에서도 부를 수 있는 조회.
 * 같은 검사를 트랜잭션 밖(빠른 거절)과 안(잠금 뒤 재확인)에서 모두 쓸 때 필요하다.
 */
export interface Queryable {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
