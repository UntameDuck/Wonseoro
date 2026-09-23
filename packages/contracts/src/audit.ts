/**
 * 감사 이벤트 — 기술설계서 v1.0 §9
 * 보안로그가 아니라 "마감 시각에 지원자가 어디까지 수행했는지"를 증명하는 업무 증적이다.
 * 업무 DB와 분리된 append-only 저장소에 hash-chain 으로 적재한다. (v1.1 §A11)
 */
export const AUDIT_ACTION = [
  'LOGIN_SUCCEEDED',
  'APPLICATION_CREATED',
  'APPLICATION_SAVED',
  'DOCUMENT_UPLOAD_STARTED',
  'DOCUMENT_VERIFIED',
  'PAYMENT_INTENT_CREATED',
  'PAYMENT_VERIFIED',
  'FINALIZE_REQUESTED',
  'FINALIZE_VALIDATION_PASSED',
  'APPLICATION_FINALIZED',
  /** 접수 성립 전 취소. 불일치 대장 D-7 — §9 목록에 추가가 필요하다. */
  'APPLICATION_CANCELLED',
  'RECEIPT_ISSUED',
  'ADMIN_VIEWED_PII',
  'ADMIN_CHANGED_CONFIG',
] as const;

export type AuditAction = (typeof AUDIT_ACTION)[number];

export interface AuditRecord {
  eventId: string;
  occurredAt: string;
  actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
  /** 가명 식별자. 원본 식별자를 그대로 쓰지 않는다. */
  actorId: string;
  applicationId?: string;
  action: AuditAction;
  result: 'ACCEPTED' | 'REJECTED' | 'FAILED';
  traceId?: string;
  sourceIpHash?: string;
  /** hash-chain. 일반 운영자에게 삭제·수정 권한을 주지 않는다. */
  prevHash: string;
  eventHash: string;
  /** 분쟁 재구성용 — v1.1 §A9 */
  clockOffsetMs?: number;
  configVersion?: string;
  deadlinePolicyVersion?: string;
}
