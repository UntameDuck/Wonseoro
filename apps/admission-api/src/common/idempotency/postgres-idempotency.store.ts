import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '../../infra/db/db.module';
import {
  IdempotencyRecord,
  IdempotencyScope,
  IdempotencyState,
  IdempotencyStore,
} from './idempotency.store';

/** 레코드 보존 기간. DDL 의 expires_at 에 넣는다. */
const TTL_HOURS = 24;

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
@Injectable()
export class PostgresIdempotencyStore extends IdempotencyStore {
  constructor(private readonly db: Db) {
    super();
  }

  async acquire(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyRecord | null> {
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);

    const inserted = await this.db.query(
      `INSERT INTO idempotency_record
         (id, application_id, operation, idempotency_key, request_hash, state, expires_at)
       VALUES ($1,$2,$3,$4,$5,'PROCESSING',$6)
       ON CONFLICT (application_id, operation, idempotency_key) DO NOTHING`,
      [randomUUID(), scope.applicationId, scope.operation, scope.key, requestHash, expiresAt],
    );

    // 우리가 방금 선점했다.
    if (inserted.rowCount === 1) return null;

    const { rows } = await this.db.query<{
      request_hash: string;
      state: IdempotencyState;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_hash, state, response_status, response_body
         FROM idempotency_record
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [scope.applicationId, scope.operation, scope.key],
    );

    const row = rows[0];
    if (!row) return null; // 만료 정리와 경합. 새 요청으로 취급한다.

    return {
      scope,
      requestHash: row.request_hash,
      state: row.state,
      ...(row.response_status !== null ? { responseStatus: row.response_status } : {}),
      ...(row.response_body !== null ? { responseBody: row.response_body } : {}),
    };
  }

  async complete(
    scope: IdempotencyScope,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_record
          SET state = 'COMPLETED', response_status = $4, response_body = $5, updated_at = now()
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3
          AND state = 'PROCESSING'`,
      [
        scope.applicationId,
        scope.operation,
        scope.key,
        responseStatus,
        JSON.stringify(responseBody ?? null),
      ],
    );
  }

  /**
   * 실패는 삭제가 아니라 FAILED 로 남긴다. (D-11)
   * 같은 키로 재시도하면 실패 기록이 남아 있으므로, 재시도 허용 여부는 호출부가 판단한다.
   */
  async fail(scope: IdempotencyScope): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_record
          SET state = 'FAILED', updated_at = now()
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3
          AND state = 'PROCESSING'`,
      [scope.applicationId, scope.operation, scope.key],
    );
  }

  /** 만료 레코드 정리. M3 에서 스케줄러로 옮긴다. */
  async purgeExpired(): Promise<number> {
    const res = await this.db.query(`DELETE FROM idempotency_record WHERE expires_at < now()`);
    return res.rowCount ?? 0;
  }
}
