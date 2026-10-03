import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
export interface CancelInput {
    applicationId: string;
    applicantId: string;
    reason: string;
    traceId?: string;
    sourceIp?: string;
}
export interface CancelResult {
    applicationId: string;
    status: 'CANCELLED';
    cancelledAt: string;
    /** 환불해야 할 결제가 있는가. 있으면 운영 큐에 올라가 사람이 처리한다. */
    refundRequired: boolean;
    paymentId: string | null;
}
/**
 * 원서 취소 — 불일치 대장 D-7 판정에 따른 구현
 *
 * 설계서는 `CANCELLED` 를 DDL·OpenAPI enum 에만 두고 전이를 정의하지 않았다.
 * 여기서 구현한 규칙은 다음과 같고, **노션 §5.6 확인이 필요하다.**
 *
 * 1. 접수가 성립하기 **전** 에만 취소할 수 있다
 *    DRAFT · READY · PAYMENT_PENDING · PAID
 *
 * 2. `FINALIZED` 는 취소하지 않는다
 *    Submission 은 원장이다. 원장을 고쳐 쓰면 "무엇이 접수되었는가" 에 답할 수 없고,
 *    감사 해시체인과 Evidence Package 가 서 있는 전제가 무너진다.
 *    접수 후 취소가 필요하다면 상태를 덮는 것이 아니라 **취소 사실을 덧붙이는**
 *    별도 레코드여야 한다. 계약에 없으므로 지금은 거부하고 입학처로 안내한다.
 *
 * 3. `FINALIZING` 에서도 취소하지 않는다
 *    Finalize 가 비행 중이다. 취소와 커밋이 경합하면 "취소했는데 접수됨" 이 생긴다.
 *    조건부 UPDATE 와 Outbox 로 막아온 것이 정확히 그 종류의 사고다.
 *
 * 4. **환불은 자동으로 하지 않는다**
 *    확정된 결제가 있으면 운영 큐에 올리고 끝낸다. 금액과 귀책 판단이 따르고
 *    되돌릴 수 없는 일이다. 코드가 임의로 돈을 움직이지 않는다. (§B16)
 */
export declare class CancellationService {
    private readonly db;
    private readonly audit;
    private readonly logger;
    constructor(db: Db, audit: AuditService);
    cancel(input: CancelInput): Promise<CancelResult>;
    /** 거부 사유를 상태별로 다르게 말한다. "불가능" 과 "지금은 안 된다" 는 다른 안내다. */
    private assertCancellable;
    /**
     * 환불 대기 항목을 Exception Queue 에 올린다.
     *
     * 대조(Reconciliation)에도 같은 검사가 있다. 중복처럼 보이지만 둘 다 필요하다 —
     * 여기서 올리는 것은 즉시 보이게 하려는 것이고, 대조는 여기가 실패했을 때의 그물이다.
     * 부분 유니크 인덱스가 중복 등록을 막아준다. (D-25)
     */
    private openRefundTask;
    private enqueueCancelledEvent;
    private load;
}
