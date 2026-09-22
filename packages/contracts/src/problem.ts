/**
 * Problem Details — 모든 오류 응답의 단일 포맷.
 * canonical: k-admission-openapi.yaml #/components/schemas/Problem
 *
 * required: [type, title, status, code, traceId]
 * `code` 와 `traceId` 는 선택이 아니다. 분쟁 시 이 두 개로 사건을 특정한다.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  /** 기계 판독용 코드. OpenAPI 상 필수. */
  code: string;
  /** 요청 추적 ID. OpenAPI 상 필수. */
  traceId: string;
  detail?: string;
  instance?: string;
  serverTime?: string;
  /** 마감 분쟁 대응용 확장 필드. Problem 스키마가 additionalProperties 를 막지 않는다. */
  deadlineAt?: string;
  deadlinePolicyVersion?: string;
}

export const PROBLEM_BASE = 'https://wonseoro.kr/problems';

export const ProblemCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DEADLINE_PASSED: 'DEADLINE_PASSED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  PAYMENT_NOT_CONFIRMED: 'PAYMENT_NOT_CONFIRMED',
  PAYMENT_STATE_UNKNOWN: 'PAYMENT_STATE_UNKNOWN',
  DOCUMENT_NOT_AVAILABLE: 'DOCUMENT_NOT_AVAILABLE',
  ALREADY_FINALIZED: 'ALREADY_FINALIZED',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  RETRYABLE: 'RETRYABLE',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type ProblemCodeValue = (typeof ProblemCode)[keyof typeof ProblemCode];

/** code 로부터 type URI 를 만든다. 둘을 따로 관리하지 않는다. */
export function problemType(code: ProblemCodeValue): string {
  return `${PROBLEM_BASE}/${code.toLowerCase().replace(/_/g, '-')}`;
}
