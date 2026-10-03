import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { AuditService } from '../audit/audit.service';
import { PaymentProviderPort } from '../payment/payment.provider';
import { PaymentService } from '../payment/payment.service';
export type Severity = 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
export type ExceptionState = 'OPEN' | 'AUTO_RESOLVED' | 'MANUAL_REVIEW' | 'RESOLVED';
export interface Finding {
    applicationId: string;
    type: string;
    severity: Severity;
    facts: Record<string, unknown>;
}
export interface ReconcileResult {
    checked: number;
    opened: number;
    autoResolved: number;
    stillOpen: number;
}
/**
 * Reconciliation Center — 기술설계서 v1.1 §A4·§B18·§C2 (T-M3-04)
 *
 * **Application · Payment · Submission · Central ACK 를 4-way 로 대조한다.**
 * Payment 는 우리 기록만이 아니라 **PG 정산 목록**과도 맞춘다(9번) — "payment provider reference" (§A11).
 *
 * 왜 필요한가
 * Payment 와 Application 은 별도 Aggregate 다. (§A4)
 * 분리했기 때문에 정합성이 자동으로 맞지 않는다 — 그게 분리의 대가다.
 * PG callback 이 유실되거나 늦게 오면 "돈은 나갔는데 접수는 안 된" 상태가 생긴다.
 * 그 상태를 **사람이 발견하기 전에 시스템이 먼저 찾아내는 것**이 이 서비스의 일이다.
 *
 * 원칙
 *   1. **불일치만 큐로 보낸다.** (§B18) 정상 건을 목록에 올리면 신호가 묻힌다
 *   2. 자동으로 고치지 않는다. 발견하고 사람에게 넘긴다.
 *      돈과 접수 기회가 걸린 상태를 코드가 임의로 바꾸면 안 된다
 *   3. 해소된 건은 AUTO_RESOLVED 로 닫는다. 큐에 남겨두면 실제 문제가 묻힌다
 *   4. 보정은 Admin Action API 로만. reason·before/after 를 감사에 남긴다 (§B16)
 *
 * ⚠️ `(application_id, exception_type)` UNIQUE 가 DDL 에 없어 중복을 코드로 막는다.
 * 동시 실행에서는 여전히 중복이 가능하다. (불일치 대장 D-25)
 */
export declare class ReconciliationService {
    private readonly db;
    private readonly audit;
    /** PG 정산 대조(9번)에 쓴다. 없으면(단위 시험) 그 검사만 건너뛴다. */
    private readonly provider?;
    private readonly payments?;
    private readonly breakers?;
    private readonly logger;
    constructor(db: Db, audit: AuditService, 
    /** PG 정산 대조(9번)에 쓴다. 없으면(단위 시험) 그 검사만 건너뛴다. */
    provider?: PaymentProviderPort | undefined, payments?: PaymentService | undefined, breakers?: DependencyBreakers | undefined);
    /**
     * 대조 1회 실행. D+1 배치와 수동 트리거가 같은 경로를 쓴다.
     * @param sinceHours 최근 몇 시간 내 원서를 볼 것인가. 전체 재검은 비싸다.
     */
    reconcile(sinceHours?: number): Promise<ReconcileResult>;
    /** 4-way 대조. 각 검사는 "무엇이 어긋났는가" 를 facts 에 담는다. */
    detect(sinceHours: number): Promise<Finding[]>;
    /**
     * PG 정산 대조.
     *
     * 재확인 워커는 PENDING·UNKNOWN 만 묻는다. 결제창만 연(CREATED) 결제는 대부분 결제하지 않고
     * 끝나므로 묻지 않는데, 그중 실제로 결제되고 콜백까지 유실된 건은 **아무도 찾지 못한다** —
     * 지원자는 돈을 냈고 원서는 접수되지 않은 채 마감이 지난다. PG 장부가 그 건을 알려준다.
     *
     *   PG 승인 · 우리 CREATED/PENDING/UNKNOWN → PG 에 다시 묻는다(verify). 재확인 워커·콜백과 같은
     *     경로라 확정되면 자동 접수까지 간다(D-42). 상태를 지어내지 않는다 — PG 의 답을 반영할 뿐이다.
     *     그래도 확정되지 않으면 PG_CONFIRMED_NOT_RECORDED (CRITICAL)
     *   우리 CONFIRMED · PG 승인 아님 → PAYMENT_NOT_SETTLED_AT_PG (CRITICAL). 돈을 안 받고 접수했을 수 있다
     *   금액이 다르다 → PAYMENT_AMOUNT_MISMATCH_AT_PG (CRITICAL)
     * PG 에만 있는 거래는 원서를 알 수 없어 예외 큐(원서 단위)에 올리지 못한다 — 로그로 남긴다.
     * PG 가 끊겼으면 이번 대조에서 이 검사만 건너뛴다. 다른 여덟 가지 대조를 막지 않는다.
     */
    private settlementFindings;
    list(state?: ExceptionState | 'ALL'): Promise<Array<{
        id: string;
        applicationId: string;
        exceptionType: string;
        severity: Severity;
        state: ExceptionState;
        facts: Record<string, unknown>;
        detectedAt: string;
    }>>;
    /**
     * 수동 해소. (§B16)
     * **사유가 필수다.** 누가 왜 닫았는지가 남지 않으면 보정 자체가 증적이 안 된다.
     * 여기서 상태를 고치지는 않는다 — 판단만 기록한다.
     */
    resolve(exceptionId: string, resolvedBy: string, resolutionCode: string, reason: string): Promise<{
        id: string;
        state: ExceptionState;
    }>;
    private query;
    /** 이미 열려 있는 같은 종류의 건이면 새로 만들지 않는다. (D-25 우회) */
    /**
     * 이미 열려 있는 같은 불일치는 다시 열지 않는다. 대조는 주기적으로 도는데
     * 실행할 때마다 쌓이면 큐를 읽을 수 없고, 읽을 수 없는 큐는 없는 큐다.
     *
     * 조회한 뒤 없으면 넣는 방식은 쓰지 않는다. 그 사이에 다른 실행이 끼어든다.
     * 판정은 부분 유니크 인덱스에 맡기고 한 번에 밀어 넣는다. (D-25 / 0002 마이그레이션)
     */
    private openIfNew;
    /**
     * 더 이상 성립하지 않는 미해결 건을 닫는다.
     * 늦게 도착한 PG callback 이나 중앙 ACK 로 저절로 풀리는 경우가 실제로 많다.
     */
    private autoResolveStale;
    private countOpen;
}
