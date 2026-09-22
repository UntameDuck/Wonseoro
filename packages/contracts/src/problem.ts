/** RFC 9457 Problem Details — 모든 오류 응답의 단일 포맷. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** 분쟁 대응용. 마감 판정이 걸린 응답에는 반드시 포함한다. */
  serverTime?: string;
  deadlineAt?: string;
  policyVersion?: string;
  traceId?: string;
}

export const PROBLEM_BASE = 'https://wonseoro.kr/problems';

export const ProblemType = {
  VALIDATION_FAILED: `${PROBLEM_BASE}/validation-failed`,
  DEADLINE_PASSED: `${PROBLEM_BASE}/deadline-passed`,
  VERSION_CONFLICT: `${PROBLEM_BASE}/version-conflict`,
  IDEMPOTENCY_KEY_REQUIRED: `${PROBLEM_BASE}/idempotency-key-required`,
  IDEMPOTENCY_KEY_REUSED: `${PROBLEM_BASE}/idempotency-key-reused`,
  PAYMENT_NOT_CONFIRMED: `${PROBLEM_BASE}/payment-not-confirmed`,
  PAYMENT_STATE_UNKNOWN: `${PROBLEM_BASE}/payment-state-unknown`,
  DOCUMENT_NOT_AVAILABLE: `${PROBLEM_BASE}/document-not-available`,
  ALREADY_FINALIZED: `${PROBLEM_BASE}/already-finalized`,
  ILLEGAL_TRANSITION: `${PROBLEM_BASE}/illegal-transition`,
  RETRYABLE: `${PROBLEM_BASE}/retryable`,
} as const;
