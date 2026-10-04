/**
 * 정보주체 권리 요청 — 대학 원서의 열람·정정·삭제·처리정지 (문서 10 G-10, 대장 D-84)
 *
 * 개인정보 보호법 제35~37조. 지원자는 자기 원서에 요청을 남기고, 입학처는 콘솔 처리 큐에서
 * 법정 기한(받은 날부터 10일 — 시행령 제41조 ④·제43조 ③·제44조 ②) 안에 결과를 회신한다.
 * 요청을 받는 것과 결과를 남기는 것까지가 이 시스템의 몫이다 — 실제 정정·삭제는 입학처가 정한 절차로 한다.
 */

/** 요청 종류. 동의 철회는 원서 1단계 동의 칸(D-81)에서, 공통원서 삭제는 공통원서 화면(D-82)에서 바로 한다 */
export const PRIVACY_REQUEST_KIND = ['ACCESS', 'CORRECTION', 'DELETION', 'SUSPENSION'] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KIND)[number];

export const PRIVACY_REQUEST_KIND_LABEL: Record<PrivacyRequestKind, string> = {
  ACCESS: '열람',
  CORRECTION: '정정',
  DELETION: '삭제',
  SUSPENSION: '처리정지',
};

/** 지원자에게 보이는 종류 설명 — 무엇을 요청하는지 */
export const PRIVACY_REQUEST_KIND_HELP: Record<PrivacyRequestKind, string> = {
  ACCESS: '대학이 이 원서로 처리하는 내 개인정보와 처리 내역을 보여 달라고 요청합니다.',
  CORRECTION: '틀린 개인정보를 바로잡아 달라고 요청합니다. 무엇을 어떻게 바꿀지 적어 주십시오.',
  DELETION: '내 개인정보를 지워 달라고 요청합니다. 접수된 원서는 법령에 따라 보존해야 하는 기간 동안 지울 수 없을 수 있습니다.',
  SUSPENSION: '내 개인정보 처리를 멈춰 달라고 요청합니다. 처리를 멈추면 전형을 진행할 수 없을 수 있습니다.',
};

/** 처리 상태. 받은 뒤 한 번만 결과가 정해지고 그 뒤로는 바뀌지 않는다 */
export const PRIVACY_REQUEST_STATUS = ['RECEIVED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'REFUSED'] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUS)[number];
export type PrivacyRequestOutcome = Exclude<PrivacyRequestStatus, 'RECEIVED'>;
export const PRIVACY_REQUEST_OUTCOME: readonly PrivacyRequestOutcome[] = ['COMPLETED', 'PARTIALLY_COMPLETED', 'REFUSED'];

export const PRIVACY_REQUEST_STATUS_LABEL: Record<PrivacyRequestStatus, string> = {
  RECEIVED: '처리 중',
  COMPLETED: '처리 완료',
  PARTIALLY_COMPLETED: '일부 처리',
  REFUSED: '처리하지 않음',
};

/** 법정 처리 기한 — 받은 날부터 10일 */
export const PRIVACY_REQUEST_DUE_DAYS = 10;
/** 기한이 이만큼 남으면 콘솔이 "곧 기한" 으로 강조한다 */
export const PRIVACY_REQUEST_DUE_SOON_DAYS = 3;

export const PRIVACY_REQUEST_DETAIL_MAX = 1000;
export const PRIVACY_REQUEST_NOTE_MAX = 2000;
/** 일부 처리·거절은 사유를 알려야 한다(제35조 ⑤·제36조 ⑥·제37조 ③) — 너무 짧은 사유를 막는다 */
export const PRIVACY_REQUEST_REASON_MIN = 10;

/** 요청번호 형식 `PR-YYYYMMDD-XXXXXX`(한국 날짜·Crockford base32 6자) */
export const PRIVACY_REQUEST_NUMBER = /^PR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$/;

/** 지원자가 자기 원서에서 보는 요청 */
export interface PrivacyRequestView {
  requestNumber: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  detail: string | null;
  receivedAt: string;
  dueAt: string;
  decidedAt: string | null;
  /** 입학처가 지원자에게 남긴 결과 안내 */
  resultNote: string | null;
}

/** 입학처 처리 큐의 한 줄 — 지원자가 쓴 내용은 담당자만 본다 */
export interface PrivacyQueueItem extends PrivacyRequestView {
  /** 원서를 찾는 번호 — 접수번호(접수 전이면 없음)와 상담 확인번호 */
  applicationNumber: string | null;
  supportCode: string;
  applicationStatus: string;
  decidedBy: string | null;
  /** 지금 기준 기한까지 남은 날(지났으면 음수) — DB 시계 */
  daysLeft: number;
  overdue: boolean;
}
