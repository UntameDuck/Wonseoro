/**
 * 중앙-대학 CloudEvents — 기술설계서 v1.1 §04
 *
 * 주의: v1.0 §6.2 예시는 `kr.admission.*` 이지만 v1.1 §04가 canonical 이며
 * `kr.kadmission.*` 를 사용한다. 후자를 따른다.
 *
 * 전달 모델: At-least-once + 소비자 Idempotency.
 */
export const EVENT_TYPE = {
  APPLICATION_FINALIZED: 'kr.kadmission.application.finalized.v1',
  APPLICATION_CANCELLED: 'kr.kadmission.application.cancelled.v1',
  PAYMENT_CONFIRMED: 'kr.kadmission.payment.confirmed.v1',
  PAYMENT_REFUNDED: 'kr.kadmission.payment.refunded.v1',
  SYNC_HEARTBEAT: 'kr.kadmission.sync.heartbeat.v1',
} as const;

export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

/** CloudEvents 1.0 확장 속성 — v1.1 §04 */
export interface KAdmissionExtensions {
  kadmissionuniversity: string;
  /** Application 별 단조 증가. gap 은 경보 및 재전송 대상. */
  kadmissionsequence: number;
  configversion: string;
  policyversion: string;
  traceparent?: string;
}

export interface CloudEventEnvelope<T> extends KAdmissionExtensions {
  specversion: '1.0';
  type: EventType;
  id: string;
  /** urn:k-admission:university:UNIV-A */
  source: string;
  time: string;
  datacontenttype: 'application/json';
  data: T;
}

/** 중앙 dedup key. 같은 (source, id) 는 한 번만 상태를 바꾼다. */
export function dedupKey(event: Pick<CloudEventEnvelope<unknown>, 'source' | 'id'>): string {
  return `${event.source}::${event.id}`;
}

/**
 * 중앙 전송 최소 페이로드.
 * 이름·주민등록번호·전화번호·이메일·주소·원서본문·첨부파일·결제수단 상세는 **넣지 않는다.**
 * 별도 목적이 있을 때만 purpose-scoped applicantSubjectToken 프로파일을 사용한다.
 */
export interface ApplicationFinalizedData {
  universityId: string;
  /** 대학 원본 식별자를 노출하지 않는 opaque id. */
  applicationId: string;
  admissionYear: number;
  admissionTypeCode: string;
  departmentCode: string;
  status: 'FINALIZED';
  submittedAt: string;
  integrityHash: string;
  /**
   * 지원자 참조 — sha256(subject_token). (불일치 대장 D-27)
   *
   * 중앙이 "내 원서" 를 추려주려면 어느 지원자의 것인지 알아야 한다. 이게 없으면
   * Dashboard 는 전체를 돌려주거나 아무것도 못 돌려준다. 둘 다 답이 아니다.
   *
   * 원문 토큰이 아니라 해시다. 요약 테이블이 Vault 와 바로 조인되면
   * 둘을 분리해 둔 의미가 사라진다.
   *
   * optional 이다 — §04 의 Schema Evolution 규칙상 optional 추가는 호환 변경이고,
   * 이 필드를 모르는 기존 대학 릴리스도 계속 이벤트를 보낼 수 있어야 한다.
   */
  subjectRef?: string;
}

export const OUTBOX_STATUS = ['PENDING', 'SENT', 'DEAD'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUS)[number];

/**
 * Schema Evolution 규칙 — v1.1 §04
 * - optional field 추가: 호환 변경
 * - required 삭제 / 의미 변경: 새 major event type
 * - 최소 N-1 동시 지원
 * - consumer 는 알 수 없는 optional field 를 무시한다
 */
export const SCHEMA_COMPAT_WINDOW = 1;
