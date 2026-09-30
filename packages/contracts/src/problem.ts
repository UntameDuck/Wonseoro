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
  /**
   * 이 원서에 이미 진행 중이거나 확정된 결제가 있다. 새 결제창을 열지 않는다 — 결제창이 둘이면
   * 이중 결제가 된다(§B4). 화면은 결제 상태 확인으로 안내한다.
   */
  PAYMENT_IN_PROGRESS: 'PAYMENT_IN_PROGRESS',
  DOCUMENT_NOT_AVAILABLE: 'DOCUMENT_NOT_AVAILABLE',
  ALREADY_FINALIZED: 'ALREADY_FINALIZED',
  /** 한 전형에는 모집단위 하나만 지원한다. (대학입학전형기본사항, D-29) */
  ONE_DEPARTMENT_PER_ADMISSION_TYPE: 'ONE_DEPARTMENT_PER_ADMISSION_TYPE',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  RETRYABLE: 'RETRYABLE',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
  /**
   * 지원자 단위 Adaptive Throttling (v1.1 §01 B6, T-M4-40). 429 + Retry-After.
   * IP 가 아니라 인증된 지원자 기준이다. OpenAPI 에 429 응답을 적는 일은 노션 §03 첨부 교체와 함께 (D-51)
   */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ProblemCodeValue = (typeof ProblemCode)[keyof typeof ProblemCode];

/** code 로부터 type URI 를 만든다. 둘을 따로 관리하지 않는다. */
export function problemType(code: ProblemCodeValue): string {
  return `${PROBLEM_BASE}/${code.toLowerCase().replace(/_/g, '-')}`;
}
