import { Injectable } from '@nestjs/common';

/**
 * Idempotency 레코드 저장소 포트.
 * canonical: k-admission-postgresql-ddl.txt — idempotency_record
 *   state CHECK (state IN ('PROCESSING','COMPLETED','FAILED'))
 *   UNIQUE (application_id, operation, idempotency_key)
 *
 * Finalize 에서는 이 레코드를 **잠금과 함께** 조회해야 하므로
 * Postgres 어댑터는 SELECT ... FOR UPDATE 를 사용한다. (v1.1 §02 Finalize 1단계)
 */
export const IDEMPOTENCY_STATE = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type IdempotencyState = (typeof IDEMPOTENCY_STATE)[number];

export interface IdempotencyRecord {
  key: string;
  /** 같은 키로 다른 요청이 오는 것을 막기 위한 요청 지문. DDL: request_hash */
  requestHash: string;
  state: IdempotencyState;
  responseStatus?: number;
  responseBody?: unknown;
  createdAt: Date;
}

export abstract class IdempotencyStore {
  /**
   * 키를 선점한다.
   * - 처음 보는 키면 PROCESSING 으로 만들고 null 을 반환한다.
   * - 이미 있으면 기존 레코드를 반환한다.
   */
  abstract acquire(key: string, requestHash: string): Promise<IdempotencyRecord | null>;
  abstract complete(key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  /** 실패한 요청. 사용자가 같은 키로 재시도할 수 있게 한다. */
  abstract release(key: string): Promise<void>;
}

/**
 * 메모리 어댑터 — 단위 테스트와 Postgres 어댑터 완성 전 로컬 개발용.
 * 프로세스가 여러 개면 동작하지 않는다. 운영에서는 절대 사용하지 않는다.
 */
@Injectable()
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async acquire(key: string, requestHash: string): Promise<IdempotencyRecord | null> {
    const existing = this.records.get(key);
    if (existing) return existing;
    this.records.set(key, {
      key,
      requestHash,
      state: 'PROCESSING',
      createdAt: new Date(),
    });
    return null;
  }

  async complete(key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const record = this.records.get(key);
    if (!record) return;
    record.state = 'COMPLETED';
    record.responseStatus = responseStatus;
    record.responseBody = responseBody;
  }

  async release(key: string): Promise<void> {
    this.records.delete(key);
  }
}
