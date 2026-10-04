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
  /** 대학별 공개 장애 공지 발행·해제 (T-M6-06, D-78). */
  'INCIDENT_PUBLISHED',
  'INCIDENT_RESOLVED',
  /** 상담원이 개인정보 최소 상담 조회로 원서 상태를 봤다 — 증적번호와 함께 (T-M6-07, D-79). */
  'SUPPORT_LOOKUP',
  /** 지원자가 원서 동의(수집·이용 등)를 하거나 거두었다 — 문안 판·해시와 함께 (D-81). */
  'CONSENT_RECORDED',
  /** 지원자가 원서의 열람·정정·삭제·처리정지를 요청했다 / 입학처가 결과를 회신했다 — 요청번호와 함께 (D-84). */
  'PRIVACY_REQUEST_RECEIVED',
  'PRIVACY_REQUEST_DECIDED',
  /** 지원자가 원서 작성 전에 지원 제한(지원 횟수·이중등록 금지 등) 고지를 확인했다 — 문안 해시와 함께 (D-86). */
  'APPLICATION_RULES_ACKNOWLEDGED',
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
