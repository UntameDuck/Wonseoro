/**
 * 전형료 반환·면제/감액 신청 — 고등교육법 시행령 제42조의3 (문서 10 G-5, 대장 D-89)
 *
 * 결제가 확인된 원서에 지원자가 반환을 신청한다. 사유는 시행령이 정한 것(착오 과납·대학 귀책·천재지변·입원·사망·
 * 단계 불합격)과 면제·감액 대상(국가보훈·기초생활수급 등 — 먼저 내고 돌려받는다). 받는 방법은 둘 이상이어야 한다
 * (제42조의3 ⑤ — 계좌이체·방문). 계좌는 원서 데이터 키로 봉하고, 입학처가 콘솔 큐에서 승인(금액)·거절(사유)로 회신한다.
 * 실제 이체·방문 지급은 대학 재무 절차다 — 이 시스템은 신청·회신·기록까지다.
 */

export const FEE_REFUND_REASON = [
  'OVERPAID',
  'UNIVERSITY_FAULT',
  'DISASTER',
  'HOSPITALIZED',
  'DECEASED',
  'STAGE_FAILED',
  'EXEMPTION',
] as const;
export type FeeRefundReason = (typeof FEE_REFUND_REASON)[number];

export const FEE_REFUND_REASON_LABEL: Record<FeeRefundReason, string> = {
  OVERPAID: '착오로 더 낸 전형료',
  UNIVERSITY_FAULT: '대학의 사정으로 응시하지 못함',
  DISASTER: '천재지변으로 응시하지 못함',
  HOSPITALIZED: '질병·사고로 입원해 응시하지 못함',
  DECEASED: '지원자 사망',
  STAGE_FAILED: '단계별 전형에서 앞 단계 불합격',
  EXEMPTION: '전형료 면제·감액 대상(국가보훈·기초생활수급 등)',
};

export const FEE_REFUND_METHOD = ['ACCOUNT', 'VISIT'] as const;
export type FeeRefundMethod = (typeof FEE_REFUND_METHOD)[number];

export const FEE_REFUND_METHOD_LABEL: Record<FeeRefundMethod, string> = {
  ACCOUNT: '계좌이체',
  VISIT: '입학처 방문 수령',
};

export const FEE_REFUND_STATUS = ['RECEIVED', 'APPROVED', 'REJECTED'] as const;
export type FeeRefundStatus = (typeof FEE_REFUND_STATUS)[number];

export const FEE_REFUND_STATUS_LABEL: Record<FeeRefundStatus, string> = {
  RECEIVED: '검토 중',
  APPROVED: '반환 결정',
  REJECTED: '반환하지 않음',
};

export const FEE_REFUND_NUMBER = /^FR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$/;
export const FEE_REFUND_DETAIL_MAX = 1000;
export const FEE_REFUND_NOTE_MAX = 2000;
export const FEE_REFUND_REASON_MIN = 10;
/** 계좌 — 은행 이름·예금주·계좌번호(숫자와 하이픈) */
export const FEE_REFUND_ACCOUNT_LIMITS = { bank: 40, holder: 40, number: 30 } as const;
export const FEE_REFUND_ACCOUNT_NUMBER = /^[0-9][0-9-]{5,29}$/;

export interface FeeRefundAccount {
  bank: string;
  holder: string;
  number: string;
}

/** 지원자가 보는 신청 — 계좌번호는 끝 네 자리만 */
export interface FeeRefundView {
  requestNumber: string;
  reason: FeeRefundReason;
  method: FeeRefundMethod;
  accountMasked: string | null;
  detail: string | null;
  status: FeeRefundStatus;
  paidAmount: number;
  approvedAmount: number | null;
  receivedAt: string;
  decidedAt: string | null;
  resultNote: string | null;
}

/** 입학처 큐 한 줄 — 계좌 원문은 한 건을 열 때만(`account`) */
export interface FeeRefundQueueItem extends FeeRefundView {
  applicationNumber: string | null;
  supportCode: string;
  applicationStatus: string;
  decidedBy: string | null;
  account: FeeRefundAccount | null;
}

/** 화면 표기 — 계좌번호 끝 네 자리만 남긴다 */
export function maskAccountNumber(number: string): string {
  const digits = number.replace(/[^0-9]/g, '');
  return digits.length <= 4 ? '****' : `${'*'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}
