/**
 * Payment 상태머신 — Application 과 **별도 Aggregate** 다. (v1.1 §A4)
 * 결제 성공과 접수 성공을 같은 상태로 취급하지 않는다.
 *
 * UNKNOWN 은 PG Callback 유실/지연 시의 정식 상태다. 삭제하지 말 것.
 */
export const PAYMENT_STATUS = [
  'INTENT_CREATED',
  'PENDING',
  'APPROVED',
  'CONFIRMED',
  'FAILED',
  'CANCELED',
  'UNKNOWN',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

/** 서버측 재검증을 통과해 Finalize 에 사용할 수 있는 상태. */
export const PAYMENT_FINALIZABLE: readonly PaymentStatus[] = ['CONFIRMED'];

/**
 * PG Adapter 표준 인터페이스 — 기술설계서 v1.0 §5.5
 * 클라이언트가 전달한 결제 성공 값은 신뢰하지 않는다. 반드시 서버가 PG에 재조회한다.
 */
export interface PaymentProvider {
  createPaymentIntent(applicationId: string, amount: number): Promise<{ paymentId: string; redirectUrl?: string }>;
  verifyPayment(providerTxId: string): Promise<{ status: PaymentStatus; providerApprovedAt?: string; amount?: number }>;
  confirmPayment(paymentId: string): Promise<{ status: PaymentStatus }>;
  cancelPayment(paymentId: string): Promise<{ status: PaymentStatus }>;
  reconcile(from: string, to: string): Promise<Array<{ providerTxId: string; status: PaymentStatus }>>;
}
