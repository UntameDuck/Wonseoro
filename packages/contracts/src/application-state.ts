/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 * canonical: k-admission-postgresql-ddl.txt (application.status CHECK)
 *            k-admission-openapi.yaml (#/components/schemas/Application)
 *
 *   DRAFT → READY → PAYMENT_PENDING → PAID → FINALIZING → FINALIZED
 *   DRAFT | READY → EXPIRED (마감)
 *   FINALIZING → PAID (재시도 가능 실패)
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
   * ⚠️ CANCELLED 는 DDL·OpenAPI 에는 있으나 v1.0 §5.6 상태 다이어그램에는 없다.
   * 어느 상태에서 어떤 권한으로 전이되는지 설계서가 정의하지 않았으므로
   * 여기서 임의로 전이를 만들지 않는다. 불일치 대장 D-7 참조.
   * 타입에는 포함한다 — DB 가 이 값을 가질 수 있기 때문이다.
   */
  'CANCELLED',
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
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}
