import { APPLICATION_STATUS_LABEL, labelOf } from '@wonseoro/contracts';

/**
 * 원서 상태를 한 문장으로 — 지원자 상태 확인(§01 C7)과 상담 조회(§B11, D-79)가 같은 문장을 쓴다.
 * 상담원이 읽어 주는 말과 지원자가 화면에서 보는 말이 달라서는 안 된다.
 */
export function applicationSummary(status: string, hasSubmission: boolean): string {
  if (hasSubmission) return '접수가 완료되었습니다. 추가로 하실 일은 없습니다.';
  switch (status) {
    case 'DRAFT':
      return '작성 중입니다. 아직 접수되지 않았습니다.';
    case 'READY':
      return '작성이 끝났습니다. 전형료 결제가 남았습니다.';
    case 'PAYMENT_PENDING':
      return '결제 진행 중입니다. 결제창을 닫으셨다면 상태를 다시 확인해 주십시오.';
    case 'PAID':
    case 'FINALIZING':
      return '결제가 확인되었습니다. 접수 처리 중입니다. 다시 결제하지 마십시오.';
    case 'EXPIRED':
      return '마감되어 접수할 수 없습니다.';
    case 'CANCELLED':
      return '취소된 원서입니다. 결제하신 전형료가 있으면 대학이 환불 절차를 안내합니다.';
    default:
      return `현재 상태: ${labelOf(APPLICATION_STATUS_LABEL, status, '확인 중')}`;
  }
}

/** 결제 안내 — 재결제를 유도하지 않는다. 중복 결제가 확인 지연보다 큰 사고다. (v1.1 §B4) */
export function paymentGuidance(status: string | null): string {
  if (status === null) return '아직 결제 내역이 없습니다.';
  return status === 'CONFIRMED'
    ? '결제가 확인되었습니다.'
    : status === 'UNKNOWN' || status === 'PENDING'
      ? '결제 확인 중입니다. 다시 결제하지 마시고 잠시 후 확인해 주십시오.'
      : status === 'FAILED' || status === 'CANCELLED'
        ? '결제가 완료되지 않았습니다. 다시 시도하실 수 있습니다.'
        : '결제 상태를 확인하는 중입니다.';
}

/** 중앙 반영 안내 — pending 이어도 **접수는 이미 완료**다. 둘을 섞지 않는다. (v1.1 §07) */
export function centralSyncGuidance(pending: number): string {
  return pending > 0
    ? '통합 조회 화면 반영이 지연되고 있습니다. 접수 자체는 이미 완료되었습니다.'
    : '통합 조회 화면까지 반영되었습니다.';
}
