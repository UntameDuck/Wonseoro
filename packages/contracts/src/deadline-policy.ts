/**
 * Deadline Policy — v1.1 §A2
 * 마감 판정 기준은 **코드 상수가 아니라 서명된 정책 버전**으로 관리한다.
 * 기본값은 FINALIZED_COMMIT_BEFORE_DEADLINE.
 */
export const DEADLINE_RULE = [
  'FINALIZED_COMMIT_BEFORE_DEADLINE',
  'REQUEST_RECEIVED_BEFORE_DEADLINE',
  'PAYMENT_APPROVED_BEFORE_DEADLINE',
] as const;

export type DeadlineRule = (typeof DEADLINE_RULE)[number];

export interface DeadlinePolicy {
  policyVersion: string;
  rule: DeadlineRule;
  deadlineAt: string;
  /** 입학처 2인 승인 없이는 활성화되지 않는다. */
  approvedBy: readonly [string, string];
  activatedAt: string;
}

/** 마감 경고 시점(분). UI 는 서버시간 기준으로만 표시한다. */
export const DEADLINE_WARNING_MINUTES = [30, 10, 5, 1] as const;
