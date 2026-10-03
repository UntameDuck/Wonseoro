/**
 * 사람 말 사전 — 화면에 내부 코드를 그대로 보이지 않는다. (T-M5-51, docs/08-ui-production-readiness.md 결정 3)
 *
 * 지원자 웹·관리자 콘솔·서버 안내문이 같은 사전을 쓴다. 전에는 같은 코드의 이름표가 화면마다 따로 있거나
 * (Self-check `LABELS`, 콘솔 `TYPE_LABEL`·`STATUS_LABEL`) 아예 없어 `OPEN`·`CONFIRMED`·`APPLICATION_CREATED` 가 보였다.
 *
 * 계약의 값 목록(APPLICATION_STATUS·PAYMENT_STATUS·…)에 값이 늘면 이 사전도 늘어야 한다 —
 * `Record<값, string>` 이라 타입 검사가 빠진 것을 잡는다.
 */
import type { ApplicationStatus } from './application-state';
import type { AuditAction } from './audit';
import type { DeadlineMode } from './deadline-policy';
import type { DocumentStatus, PaymentStatus } from './payment-state';
import { EVENT_TYPE, type EventType, type OutboxStatus } from './events';

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: '작성 중',
  READY: '작성 완료',
  PAYMENT_PENDING: '결제 진행 중',
  PAID: '결제 완료 · 접수 처리 중',
  FINALIZING: '접수 처리 중',
  FINALIZED: '접수 완료',
  CANCELLED: '취소됨',
  EXPIRED: '마감됨',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  CREATED: '결제창 열림',
  PENDING: '결제 확인 중',
  UNKNOWN: '결제 확인 중 (결제사 응답 대기)',
  CONFIRMED: '결제 확인됨',
  FAILED: '결제되지 않음',
  CANCELLED: '결제 취소됨',
  REFUNDED: '환불됨',
};

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADING: '업로드 중',
  QUARANTINED: '검사 중',
  AVAILABLE: '검사 완료',
  REJECTED: '검사 통과 못 함',
  DELETED: '삭제됨',
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN_SUCCEEDED: '로그인',
  APPLICATION_CREATED: '원서 생성',
  APPLICATION_SAVED: '원서 저장',
  DOCUMENT_UPLOAD_STARTED: '서류 업로드',
  DOCUMENT_VERIFIED: '서류 검사',
  PAYMENT_INTENT_CREATED: '결제 시작',
  PAYMENT_VERIFIED: '결제 확인',
  FINALIZE_REQUESTED: '접수 요청',
  FINALIZE_VALIDATION_PASSED: '접수 검증 통과',
  APPLICATION_FINALIZED: '접수 완료',
  APPLICATION_CANCELLED: '원서 취소',
  RECEIPT_ISSUED: '접수증 발급',
  ADMIN_VIEWED_PII: '담당자 열람',
  ADMIN_CHANGED_CONFIG: '담당자 처리',
  INCIDENT_PUBLISHED: '장애 공지 발행',
  INCIDENT_RESOLVED: '장애 공지 해제',
};

export const AUDIT_RESULT_LABEL: Record<'ACCEPTED' | 'REJECTED' | 'FAILED', string> = {
  ACCEPTED: '처리됨',
  REJECTED: '거절됨',
  FAILED: '실패',
};

export const ACTOR_TYPE_LABEL: Record<'APPLICANT' | 'ADMIN' | 'SYSTEM', string> = {
  APPLICANT: '지원자',
  ADMIN: '담당자',
  SYSTEM: '시스템',
};

export const DEADLINE_MODE_LABEL: Record<DeadlineMode, string> = {
  FINALIZED_COMMIT_BEFORE_DEADLINE: '마감 전에 접수가 확정된 원서만 인정',
  REQUEST_RECEIVED_BEFORE_DEADLINE: '마감 전에 접수 요청이 들어온 원서까지 인정',
  PAYMENT_APPROVED_BEFORE_DEADLINE: '마감 전에 결제가 승인된 원서까지 인정',
};

/** 서명된 적용 기록의 종류 (activation_record.kind) */
export const ACTIVATION_KIND_LABEL: Record<'ACTIVATE' | 'EXTEND' | 'ROLLBACK', string> = {
  ACTIVATE: '적용',
  EXTEND: '연장',
  ROLLBACK: '되돌리기',
};

/** 설정 버전 상태 (config_version.status) */
export const CONFIG_VERSION_STATUS_LABEL: Record<'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED', string> = {
  DRAFT: '승인 대기',
  APPROVED: '승인 완료 · 적용 전',
  ACTIVE: '적용 중',
  RETIRED: '이전 버전',
};

export const OUTBOX_STATUS_LABEL: Record<OutboxStatus | 'SENDING', string> = {
  PENDING: '전송 대기',
  SENDING: '전송 중',
  SENT: '전송됨',
  DEAD: '전송 포기',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  [EVENT_TYPE.APPLICATION_FINALIZED]: '접수 완료 알림',
  [EVENT_TYPE.APPLICATION_CANCELLED]: '원서 취소 알림',
  [EVENT_TYPE.PAYMENT_CONFIRMED]: '결제 확인 알림',
  [EVENT_TYPE.SYNC_HEARTBEAT]: '대학 상태 신호',
};

/* ── 대조 · 예외 (reconciliation_exception) ─────────────────────────────── */

export const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  PAYMENT_CONFIRMED_WITHOUT_SUBMISSION: '결제는 확인됐는데 접수 기록이 없음',
  SUBMISSION_WITHOUT_CONFIRMED_PAYMENT: '접수됐는데 확인된 결제가 없음',
  FINALIZED_WITHOUT_SUBMISSION: '확정 상태인데 접수 원장이 없음 (DB 손상 의심)',
  SUBMISSION_WITHOUT_FINALIZED_STATUS: '접수 원장과 원서 상태가 어긋남',
  CENTRAL_ACK_MISSING: '통합 조회 반영 지연 — 접수 실패 아님',
  OUTBOX_DEAD_LETTER: '통합 조회 전송을 포기한 알림',
  PAYMENT_STATE_UNKNOWN_STALE: '확인 못 한 결제가 오래 방치됨',
  REFUND_REQUIRED_AFTER_CANCEL: '취소된 원서에 환불이 필요함',
  PG_CONFIRMED_NOT_RECORDED: '결제사는 승인했는데 우리 기록은 미확인',
  PAYMENT_NOT_SETTLED_AT_PG: '우리는 확인했는데 결제사 정산에 승인이 없음',
  PAYMENT_AMOUNT_MISMATCH_AT_PG: '결제사 정산 금액이 우리 기록과 다름',
};

export const EXCEPTION_STATE_LABEL: Record<'OPEN' | 'MANUAL_REVIEW' | 'RESOLVED' | 'AUTO_RESOLVED', string> = {
  OPEN: '미해결',
  MANUAL_REVIEW: '수동 검토 중',
  RESOLVED: '해소됨',
  AUTO_RESOLVED: '자동 해소',
};

export const EXCEPTION_SEVERITY_LABEL: Record<'CRITICAL' | 'HIGH' | 'WARN' | 'INFO', string> = {
  CRITICAL: '긴급',
  HIGH: '높음',
  WARN: '주의',
  INFO: '안내',
};

/** 대조가 발견 당시 남긴 사실(facts)의 항목 이름. 대조 검사의 SELECT 열 이름·객체 키다. */
export const EXCEPTION_FACT_LABEL: Record<string, string> = {
  payment_id: '결제 번호',
  paymentId: '결제 번호',
  amount: '금액',
  verified_at: '결제 확인 시각',
  application_number: '접수번호',
  finalized_at: '접수 확정 시각',
  status: '상태',
  updated_at: '마지막 변경',
  created_at: '생성 시각',
  attempt_count: '전송 시도',
  event_type: '알림 종류',
  providerTxId: '결제사 거래번호',
  ourStatus: '우리 기록',
  pgStatus: '결제사 기록',
  afterVerify: '재확인 결과',
  ourAmount: '우리 기록 금액',
  pgAmount: '결제사 금액',
};

/* ── 담당자 역할 ───────────────────────────────────────────────────────── */

/** 담당자 렐름의 역할(노션 06). 콘솔 머리글이 로그인한 담당자의 역할을 이 이름으로 보인다 (T-M5-10) */
export const STAFF_ROLE_LABEL: Record<string, string> = {
  'admission-admin': '입학처 담당',
  'security-auditor': '보안 감사',
  'platform-viewer': '플랫폼 조회',
  'sre-operator': '운영 지원',
  'release-controller': '배포 관리',
  'break-glass': '비상 접근',
};

/* ── 보존기간 ─────────────────────────────────────────────────────────── */

/** 보존 정책 검사 문제의 분류. 데이터 종류 코드는 RETENTION_CATEGORIES 의 label 을 쓴다 — 이것은 그 밖의 분류다. */
export const RETENTION_PROBLEM_LABEL: Record<string, string> = {
  '*': '보존 설정 전체',
};

/**
 * 사전에서 이름을 찾는다. 없으면 `fallback` — 지원자 화면은 원문 대신 일반 문구를 준다.
 * 콘솔은 문의·검색을 위해 원문을 fallback 으로 넘길 수 있다.
 */
export function labelOf(dict: Record<string, string>, code: string | null | undefined, fallback?: string): string {
  if (code && Object.prototype.hasOwnProperty.call(dict, code)) return dict[code]!;
  return fallback ?? code ?? '-';
}
