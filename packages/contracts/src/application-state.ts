/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 * canonical: k-admission-postgresql-ddl.txt (application.status CHECK)
 *            k-admission-openapi.yaml (#/components/schemas/Application)
 *
 *   DRAFT → READY → PAYMENT_PENDING → PAID → FINALIZING → FINALIZED
 *   DRAFT | READY → EXPIRED (마감)
 *   FINALIZING → PAID (재시도 가능 실패)
 *   DRAFT | READY | PAYMENT_PENDING | PAID → CANCELLED (접수 성립 전 취소, D-7)
 *
 * FINALIZED 는 종착 상태다. 일반 사용자 API 에 되돌리는 경로를 만들지 않는다.
 */
export const APPLICATION_STATUS = [
  'DRAFT',
  'READY',
  'PAYMENT_PENDING',
  'PAID',
  'FINALIZING',
  'FINALIZED',
  /**
   * 접수가 성립하기 **전** 에 지원자가 그만두는 상태. (D-7 판정)
   * 접수 성립 후의 취소는 이 상태가 아니다 — 아래 CANCELLATION 주석 참조.
   */
  'CANCELLED',
  'EXPIRED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

/** 허용된 전이만 정의한다. 여기에 없는 전이는 코드에서 거부한다. */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  DRAFT: ['READY', 'EXPIRED', 'CANCELLED'],
  READY: ['PAYMENT_PENDING', 'DRAFT', 'EXPIRED', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'READY', 'CANCELLED'],
  PAID: ['FINALIZING', 'CANCELLED'],
  FINALIZING: ['FINALIZED', 'PAID'],
  FINALIZED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}

/* ── 취소 (불일치 대장 D-7) ─────────────────────────────────────────────
 *
 * 설계서는 `CANCELLED` 를 DDL·OpenAPI enum 에만 두고 전이를 정의하지 않았다.
 * 여기서 내린 판정은 다음과 같다. **노션 §5.6 확인이 필요하다.**
 *
 * 취소는 하나가 아니라 두 가지 다른 일이다.
 *
 * 1. 접수 성립 **전** 취소 — 이 상태로 표현한다
 *    아직 접수가 성립하지 않았으므로 되돌릴 것이 없다. 지원자가 그만두는 것뿐이다.
 *
 * 2. 접수 성립 **후** 취소 — 이 상태로 표현하지 **않는다**
 *    Submission 은 원장이다. 원장을 고쳐 쓰면 "무엇이 접수되었는가" 에 답할 수 없다.
 *    감사 해시체인과 Evidence Package 가 서 있는 전제가 무너진다.
 *    필요하다면 취소 **사실을 덧붙이는** 별도 레코드여야 한다 — 계약에 없으므로
 *    노션 결정 전까지 거부한다.
 *
 * FINALIZING 에서는 취소할 수 없다.
 * Finalize 가 비행 중이다. 취소와 커밋이 경합하면 "취소했는데 접수됨" 이 생긴다.
 * 조건부 UPDATE 와 Outbox 로 막아온 것이 정확히 그 종류의 사고다.
 */

/** 지원자 본인이 직접 취소할 수 있는 상태. 아직 돈이 오가지 않았다. */
export const CANCELLABLE_BY_APPLICANT: readonly ApplicationStatus[] = ['DRAFT', 'READY'];

/**
 * 돈이 걸린 취소. 지원자 요청은 받되 **환불은 자동으로 하지 않는다.**
 * 환불은 사람이 승인한다 — 금액과 귀책 판단이 따르고, 되돌릴 수 없는 일이다.
 */
export const CANCELLABLE_WITH_REFUND: readonly ApplicationStatus[] = ['PAYMENT_PENDING', 'PAID'];

export function canCancel(status: ApplicationStatus): boolean {
  return (
    CANCELLABLE_BY_APPLICANT.includes(status) || CANCELLABLE_WITH_REFUND.includes(status)
  );
}

/** 취소 시 환불 의무가 생기는가. 확정된 결제가 따로 있는지는 호출 측이 확인한다. */
export function cancellationMayRequireRefund(status: ApplicationStatus): boolean {
  return CANCELLABLE_WITH_REFUND.includes(status);
}
