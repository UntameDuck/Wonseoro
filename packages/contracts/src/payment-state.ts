/**
 * Payment 상태머신 — Application 과 **별도 Aggregate** 다. (v1.1 §A4)
 * canonical: k-admission-postgresql-ddl.txt (payment.status CHECK)
 *            k-admission-openapi.yaml (#/components/schemas/Payment)
 *
 * 결제 성공과 접수 성공을 같은 상태로 취급하지 않는다.
 * UNKNOWN 은 PG Callback 유실/지연 시의 정식 상태다. 삭제하지 말 것. (v1.1 §B4)
 */
export const PAYMENT_STATUS = [
  'CREATED',
  'PENDING',
  'UNKNOWN',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

/**
 * 서버측 재검증을 통과해 Finalize 에 사용할 수 있는 상태.
 * CONFIRMED 하나뿐이다. PENDING·UNKNOWN 으로 Finalize 하지 않는다.
 */
export const PAYMENT_FINALIZABLE: readonly PaymentStatus[] = ['CONFIRMED'];

/** 사용자에게 재결제를 유도해도 되는 상태. UNKNOWN 은 포함하지 않는다 — 중복 결제가 더 큰 사고다. */
export const PAYMENT_RETRYABLE: readonly PaymentStatus[] = ['FAILED', 'CANCELLED'];

/**
 * PG Adapter 표준 인터페이스 — 기술설계서 v1.0 §5.5
 * 클라이언트가 전달한 결제 성공 값은 신뢰하지 않는다. 반드시 서버가 PG 에 재조회한다.
 */
export interface PaymentProvider {
  createPaymentIntent(applicationId: string, amount: number): Promise<{ paymentId: string; providerPayload: Record<string, unknown> }>;
  verifyPayment(providerTxId: string): Promise<{ status: PaymentStatus; providerApprovedAt?: string; amount?: number }>;
  confirmPayment(paymentId: string): Promise<{ status: PaymentStatus }>;
  cancelPayment(paymentId: string): Promise<{ status: PaymentStatus }>;
  reconcile(from: string, to: string): Promise<Array<{ providerTxId: string; status: PaymentStatus }>>;
}

/** Document 상태 — canonical: DDL document.status CHECK / OpenAPI #/schemas/Document */
export const DOCUMENT_STATUS = [
  'UPLOADING',
  'QUARANTINED',
  'AVAILABLE',
  'REJECTED',
  'DELETED',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

/** 접수 확정에 쓸 수 있는 서류 상태. AVAILABLE 하나뿐이다. */
export const DOCUMENT_FINALIZABLE: readonly DocumentStatus[] = ['AVAILABLE'];
