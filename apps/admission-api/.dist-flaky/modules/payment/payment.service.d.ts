import { PaymentStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { AuditService } from '../audit/audit.service';
import { PaymentProviderPort } from './payment.provider';
export interface PaymentRow {
    id: string;
    applicationId: string;
    provider: string;
    providerTxId: string | null;
    amount: number;
    currency: string;
    status: PaymentStatus;
    providerApprovedAt: string | null;
    verifiedAt: string | null;
}
/**
 * 결제 — 기술설계서 v1.0 §5.5, v1.1 §A4·§B4
 *
 * **Payment 는 Application 과 별도 Aggregate 다.**
 * 결제 성공과 접수 성공을 같은 상태로 취급하면, PG callback 이 유실되거나
 * 늦게 올 때 "돈은 나갔는데 접수는 안 된" 상태가 설명 불가능해진다.
 *
 * 절대 규칙
 *   1. 클라이언트가 보낸 결제 성공 값을 신뢰하지 않는다. 서버가 PG 에 재조회한다.
 *   2. 응답을 못 받으면 UNKNOWN 이다. FAILED 로 떨어뜨리지 않는다.
 *      사용자에게 재결제를 유도하면 중복 결제가 된다. 그게 더 큰 사고다.
 *   3. Finalize 에 쓸 수 있는 상태는 CONFIRMED 하나뿐이다.
 *   4. PG 가 끊겨도(Circuit Breaker OPEN) **fail-open 하지 않는다.** (v1.1 §01 C8)
 *      확인 못 한 결제는 UNKNOWN 이고, 그 뒤는 Reconciliation 이 맡는다.
 */
export declare class PaymentService {
    private readonly db;
    private readonly provider;
    private readonly audit;
    private readonly breakers;
    private readonly logger;
    constructor(db: Db, provider: PaymentProviderPort, audit: AuditService, breakers: DependencyBreakers);
    /** 확인하지 못한 결제를 UNKNOWN 으로 내려도 되는 상태. 이미 결론이 난 결제는 건드리지 않는다. */
    private static readonly UNVERIFIED_TO_UNKNOWN;
    /**
     * 결제 전 확인 · 결제 확정 뒤 처리 — 접수(finalization) 모듈이 등록한다. (D-42)
     *
     * 결제 모듈이 접수 모듈을 직접 부르면 서로를 import 하게 된다(접수는 결제 스냅샷을 쓴다).
     * 그래서 접수 쪽이 기동할 때 여기에 걸어 둔다.
     */
    private readonly intentGuards;
    private readonly confirmedListeners;
    /** 결제 의도를 만들기 전에 부른다. 던지면 결제창을 열지 않는다. */
    guardIntent(guard: (applicationId: string) => Promise<void>): void;
    /** 결제가 처음 CONFIRMED 가 된 뒤(커밋 후) 부른다. 어느 경로로 확인됐든 같다. */
    onConfirmed(listener: (payment: PaymentRow) => Promise<void>): void;
    /** 원서에 살아 있는 결제 — 결론이 나지 않았거나(CREATED·PENDING·UNKNOWN) 확정된(CONFIRMED) 것. */
    private static readonly LIVE;
    /**
     * 전형료 결제 의도 생성.
     * 금액은 클라이언트가 보내지 않는다. 대학 설정(admission_type.fee_amount)이 최종 기준이다. (v1.1 §10 §1)
     *
     * **한 원서에 살아 있는 결제는 하나다.** 결제창이 둘 열리면 둘 다 결제될 수 있다 — 이중 결제는
     * 확인 지연보다 큰 사고다 (§B4). 그래서
     *   - 결제창만 연(CREATED) 결제가 있으면 새로 만들지 않고 **그 결제창을 다시 연다** (200)
     *   - 확인 중(PENDING·UNKNOWN)이거나 확정(CONFIRMED)이면 409 PAYMENT_IN_PROGRESS — 다시 결제하지 않게
     *   - 실패·취소(FAILED·CANCELLED)만 새 결제를 허용한다 (PAYMENT_RETRYABLE)
     * 결제를 만들면 원서는 PAYMENT_PENDING 이 되고 더 고칠 수 없다 (D-55).
     */
    createIntent(applicationId: string, applicantId: string, context: {
        traceId?: string;
        sourceIp?: string;
    }): Promise<{
        payment: PaymentRow;
        providerPayload: Record<string, unknown>;
        created: boolean;
    }>;
    /**
     * 결제를 시작한 원서는 PAYMENT_PENDING 이다 — 결제 전 확인을 통과했으니 작성 완료(READY)를 거친다.
     * 이미 PAYMENT_PENDING 이면(결제창 재개) 그대로다. 취소·마감된 원서면 결제를 만들지 않는다.
     */
    private startPayment;
    /** 가장 최근의 살아 있는 결제. 결제 의도 생성의 잠금 안팎에서 같은 규칙으로 본다. */
    private livePayment;
    /** 결제창만 열린 결제는 다시 열고, 확인 중·확정된 결제면 새 결제를 거절한다. */
    private resumeOrRefuse;
    /**
     * 서버측 재검증.
     *
     * 이 메서드는 **트랜잭션 밖에서** 호출된다. 외부 PG 호출이 들어 있기 때문이다.
     * 트랜잭션 안에서 부르면 락 유지 시간이 PG 지연에 묶인다. (v1.1 §B3)
     */
    verify(paymentId: string, context?: {
        traceId?: string;
    }): Promise<PaymentRow>;
    private verifyTracked;
    /**
     * 확정 알림. 트랜잭션이 커밋된 뒤다. 듣는 쪽의 실패가 결제 확인을 되돌리지 않는다 —
     * 결제는 확인됐고, 그 뒤의 일이 실패하면 대조(PAYMENT_CONFIRMED_WITHOUT_SUBMISSION)가 찾는다.
     */
    private notifyConfirmed;
    /**
     * PG 콜백 — v1.1 §A4 "Callback + Provider Polling 이중 확인" (D-40)
     *
     * 1. 서명은 컨트롤러가 어댑터로 확인했다. 여기 오는 것은 서명이 맞는 콜백뿐이다
     * 2. **같은 콜백은 한 번만 처리한다.** PG 는 응답을 못 받으면 같은 콜백을 다시 보낸다.
     *    `payment_event(payment_id, provider_event_id)` 유니크가 막는다 (canonical DDL)
     * 3. **콜백이 말하는 상태를 믿지 않는다.** PG 에 다시 묻고(verify) 그 답으로 정한다.
     *    콜백 본문은 위조·재전송·순서 뒤바뀜이 모두 가능하다
     * 4. 결제가 처음 확인되면 자동 Finalize listener를 부른다. 결제 의도 생성이 제출 의사 표시다. (D-42)
     */
    handleCallback(notice: {
        providerTxId: string;
        eventId: string;
        rawHash: string;
    }): Promise<{
        outcome: 'UNKNOWN_TX' | 'DUPLICATE' | 'VERIFIED';
        status?: PaymentStatus;
    }>;
    load(paymentId: string): Promise<PaymentRow>;
    /**
     * Finalize 가 쓸 결제 스냅샷.
     * CONFIRMED 가 아니면 접수를 진행하지 않는다.
     */
    confirmedFor(applicationId: string): Promise<PaymentRow>;
    /** 상태 전이 + PaymentEvent 기록. 한 트랜잭션 안에서 한다. */
    private apply;
    /**
     * 결제 결론을 원서에 반영한다.
     *   CONFIRMED        → PAID. 결제를 시작해도 원서가 DRAFT 로 남던 옛 데이터도 차례로 올린다 — 돈은 이미 받았다
     *   FAILED·CANCELLED → READY (다른 살아 있는 결제가 없을 때). 다시 결제할 수 있다
     *   그 밖            → 그대로 (아직 모른다)
     * 취소·마감·접수된 원서는 건드리지 않는다 — 취소 뒤 확정된 결제는 환불 대상이다(대조가 찾는다).
     */
    private followApplication;
    private toRow;
}
