import { Injectable } from '@nestjs/common';

/**
 * Idempotency 레코드 저장소 포트.
 *
 * ⚠️ Postgres 어댑터는 노션 §02 첨부 DDL(IDEMPOTENCY_RECORD) 배치 후 구현한다.
 * 지금 DDL을 임의로 작성하면 설계 원본이 둘로 갈라진다. (불일치 대장 D-5)
 * Finalize 에서는 이 레코드를 **잠금과 함께** 조회해야 하므로
 * Postgres 어댑터는 SELECT ... FOR UPDATE 를 사용한다. (v1.1 §02 Finalize 1단계)
 */
export interface IdempotencyRecord {
  key: string;
  /** 같은 키로 다른 요청이 오는 것을 막기 위한 요청 지문. */
  requestHash: string;
  status: 'IN_FLIGHT' | 'COMPLETED';
  responseStatus?: number;
  responseBody?: unknown;
  createdAt: Date;
}

export abstract class IdempotencyStore {
  /**
   * 키를 선점한다.
   * - 처음 보는 키면 IN_FLIGHT 로 만들고 null 을 반환한다.
   * - 이미 있으면 기존 레코드를 반환한다.
   */
  abstract acquire(key: string, requestHash: string): Promise<IdempotencyRecord | null>;
  abstract complete(key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  abstract release(key: string): Promise<void>;
}

/**
 * 메모리 어댑터 — 단위 테스트와 DDL 도착 전 로컬 개발용.
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
      status: 'IN_FLIGHT',
      createdAt: new Date(),
    });
    return null;
  }

  async complete(key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const record = this.records.get(key);
    if (!record) return;
    record.status = 'COMPLETED';
    record.responseStatus = responseStatus;
    record.responseBody = responseBody;
  }

  async release(key: string): Promise<void> {
    this.records.delete(key);
  }
}
