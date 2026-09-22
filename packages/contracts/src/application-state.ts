/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 *
 *   DRAFT → READY → PAYMENT_PENDING → PAID → FINALIZING → FINALIZED
 *   DRAFT | READY → EXPIRED (마감)
 *   FINALIZING → PAID (재시도 가능 실패)
 *
 * FINALIZED 는 종착 상태다. 일반 사용자 API로 되돌릴 수 없다.
 */
export const APPLICATION_STATUS = [
  'DRAFT',
  'READY',
  'PAYMENT_PENDING',
  'PAID',
  'FINALIZING',
  'FINALIZED',
  'EXPIRED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

/** 허용된 전이만 정의한다. 여기에 없는 전이는 코드에서 거부한다. */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  DRAFT: ['READY', 'EXPIRED'],
  READY: ['PAYMENT_PENDING', 'DRAFT', 'EXPIRED'],
  PAYMENT_PENDING: ['PAID', 'READY'],
  PAID: ['FINALIZING'],
  FINALIZING: ['FINALIZED', 'PAID'],
  FINALIZED: [],
  EXPIRED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}
