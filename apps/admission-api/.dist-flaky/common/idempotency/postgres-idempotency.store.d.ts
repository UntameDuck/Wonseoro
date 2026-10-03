import { Db } from '@wonseoro/server-kit';
import { IdempotencyRecord, IdempotencyScope, IdempotencyStore } from './idempotency.store';
/**
 * Postgres 어댑터.
 *
 * 선점은 `INSERT ... ON CONFLICT DO NOTHING` 한 방으로 한다.
 * SELECT 후 INSERT 하면 마감 피크의 동시 요청에서 둘 다 통과한다.
 * INSERT 가 0건이면 다른 요청이 먼저 잡은 것이므로 그때 읽는다.
 *
 * Finalize 에서는 `acquireForUpdate` 로 행을 잠근 뒤 트랜잭션을 진행한다.
 * (v1.1 §02 Finalize 1단계 — Idempotency record 확인/잠금)
 */
export declare class PostgresIdempotencyStore extends IdempotencyStore {
    private readonly db;
    constructor(db: Db);
    acquire(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyRecord | null>;
    complete(scope: IdempotencyScope, responseStatus: number, responseBody: unknown): Promise<void>;
    /**
     * 실패는 삭제가 아니라 FAILED 로 남긴다. (D-11)
     * 같은 키로 재시도하면 실패 기록이 남아 있으므로, 재시도 허용 여부는 호출부가 판단한다.
     */
    fail(scope: IdempotencyScope): Promise<void>;
    /**
     * 만료 레코드 정리. 예약 작업(IdempotencyPurgeScheduler)이 부른다.
     * 한 번에 batch 건씩 지운다 — 쌓인 것을 한 문장으로 지우면 잠금과 WAL 이 한꺼번에 몰린다.
     */
    purgeExpired(batch?: number): Promise<number>;
    applicationOf(ref: {
        paymentId?: string;
        documentId?: string;
    }): Promise<string | null>;
}
