import { Injectable } from '@nestjs/common';

/**
 * Idempotency 레코드 저장소 포트.
 * canonical: k-admission-postgresql-ddl.txt — idempotency_record
 *   state CHECK (state IN ('PROCESSING','COMPLETED','FAILED'))
 *   UNIQUE (application_id, operation, idempotency_key)
 *   application_id uuid NOT NULL REFERENCES application(id)
 *
 * ⚠️ application_id 가 NOT NULL 이라 **원서 생성(POST /applications)은 이 테이블을 쓸 수 없다.**
 * 아직 application 이 없기 때문이다. 불일치 대장 D-12 참조.
 * 생성의 중복은 application 의 자연키
 * UNIQUE (cycle_id, applicant_id, admission_type_id, department_id) 가 막는다.
 */
export const IDEMPOTENCY_STATE = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type IdempotencyState = (typeof IDEMPOTENCY_STATE)[number];

/** DDL 의 UNIQUE (application_id, operation, idempotency_key) 와 1:1 대응한다. */
export interface IdempotencyScope {
  applicationId: string;
  /** 같은 키를 다른 작업에 재사용해도 서로 간섭하지 않게 한다. 예: 'finalize' */
  operation: string;
  key: string;
}

export interface IdempotencyRecord {
  scope: IdempotencyScope;
  /** 같은 키로 다른 요청이 오는 것을 막기 위한 요청 지문. DDL: request_hash */
  requestHash: string;
  state: IdempotencyState;
  responseStatus?: number;
  responseBody?: unknown;
}

export abstract class IdempotencyStore {
  /**
   * 키를 선점한다.
   * - 처음 보는 키면 PROCESSING 으로 만들고 null 을 반환한다.
   * - 이미 있으면 기존 레코드를 반환한다.
   */
  abstract acquire(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyRecord | null>;
  abstract complete(
    scope: IdempotencyScope,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void>;
  /** 실패를 기록한다. DDL 은 삭제가 아니라 FAILED 상태를 둔다. (D-11) */
  abstract fail(scope: IdempotencyScope): Promise<void>;
}

export function scopeKey(scope: IdempotencyScope): string {
  return `${scope.applicationId}::${scope.operation}::${scope.key}`;
}

/**
 * 메모리 어댑터 — 단위 테스트용.
 * 프로세스가 여러 개면 동작하지 않는다. 운영에서는 절대 사용하지 않는다.
 */
@Injectable()
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async acquire(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyRecord | null> {
    const k = scopeKey(scope);
    const existing = this.records.get(k);
    if (existing) return existing;
    this.records.set(k, { scope, requestHash, state: 'PROCESSING' });
    return null;
  }

  async complete(
    scope: IdempotencyScope,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    const record = this.records.get(scopeKey(scope));
    if (!record) return;
    record.state = 'COMPLETED';
    record.responseStatus = responseStatus;
    record.responseBody = responseBody;
  }

  async fail(scope: IdempotencyScope): Promise<void> {
    const record = this.records.get(scopeKey(scope));
    if (!record) return;
    record.state = 'FAILED';
  }
}
