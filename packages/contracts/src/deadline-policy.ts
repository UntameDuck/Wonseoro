/**
 * Deadline Policy — v1.1 §A2
 * canonical: k-admission-postgresql-ddl.txt (deadline_policy.mode CHECK)
 *            k-admission-openapi.yaml (CreateDeadlinePolicyRequest.mode)
 *
 * 마감 판정 기준은 **코드 상수가 아니라 서명된 정책 버전**으로 관리한다.
 * 필드명은 `mode` 다. (`rule` 아님 — 불일치 대장 D-9)
 */
export const DEADLINE_MODE = [
  'FINALIZED_COMMIT_BEFORE_DEADLINE',
  'REQUEST_RECEIVED_BEFORE_DEADLINE',
  'PAYMENT_APPROVED_BEFORE_DEADLINE',
] as const;

export type DeadlineMode = (typeof DEADLINE_MODE)[number];

export interface DeadlinePolicy {
  /** DDL: deadline_policy.version */
  version: string;
  mode: DeadlineMode;
  deadlineAt: string;
  /** DDL: approved_by_1 / approved_by_2. CHECK (approved_by_1 <> approved_by_2) */
  approvedBy1: string;
  approvedBy2: string;
  approvedAt: string;
  /** 활성화 전이면 null. */
  activatedAt: string | null;
  policyHash: string;
}

/** 마감 경고 시점(분). UI 는 서버시간 기준으로만 표시한다. */
export const DEADLINE_WARNING_MINUTES = [30, 10, 5, 1] as const;

/** OpenAPI #/components/schemas/ServerTime — GET /api/v1/meta/time 응답 계약 */
export interface ServerTime {
  serverTime: string;
  deadlineAt: string;
  /** 필드명 주의: policyVersion 이 아니라 deadlinePolicyVersion 이다. */
  deadlinePolicyVersion: string;
  clockOffsetMs?: number;
}
