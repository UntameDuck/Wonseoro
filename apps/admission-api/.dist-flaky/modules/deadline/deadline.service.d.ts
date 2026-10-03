import { DeadlinePolicy, ServerTime } from '@wonseoro/contracts';
import { MAX_CLOCK_OFFSET_MS } from '../../common/time/server-clock';
import { DeadlinePolicyPort } from './deadline-policy.port';
/** 허용 clock offset. 정의는 서버 시각 모듈에 있다. (v1.1 §A9) */
export { MAX_CLOCK_OFFSET_MS };
/**
 * OpenAPI ServerTime 계약 + 화면 표시용 부가 정보.
 * ServerTime 스키마는 additionalProperties 를 막지 않으므로 확장 필드를 실을 수 있다.
 */
export interface DeadlineSnapshot extends ServerTime {
    remainingMs: number;
    /** 30 / 10 / 5 / 1 분 경고 중 현재 해당하는 값. */
    warningMinutes: number | null;
    passed: boolean;
}
/** 마감 판정에 쓰는 시각들. 어느 것을 인정할지는 정책 mode 가 정한다. */
export interface DeadlineEvaluationInput {
    /** 제출 요청이 서버에 도달한 시각. */
    requestReceivedAt: Date;
    /** PG 가 승인한 시각. 결제 이전 단계면 undefined. */
    paymentApprovedAt?: Date;
    /** DB 커밋 시각. Finalize 직전에는 "지금"을 넣는다. */
    commitAt: Date;
}
/**
 * 마감 판정 — 기술설계서 v1.1 §A2
 *
 * 절대 규칙
 *   1. 브라우저가 보낸 시각을 쓰지 않는다. 서버 시각만 쓴다.
 *   2. 마감 시각을 코드 상수로 박지 않는다. 정책 객체에서 읽는다.
 *   3. 마감 관련 오류 응답에는 serverTime·deadlineAt·deadlinePolicyVersion 을 반드시 싣는다.
 *   4. 어느 시점을 "기한 내"로 인정할지는 업무규정이 정한다. 개발자가 정하지 않는다.
 */
export declare class DeadlineService {
    private readonly policies;
    private readonly logger;
    constructor(policies: DeadlinePolicyPort);
    /**
     * 화면 표시용 스냅샷. GET /api/v1/meta/time 과 모든 원서 응답에 싣는다.
     * 서버 시각은 DB 시계에 맞춘 값이고(§A2), 이 노드가 잰 offset 을 함께 준다(§A9).
     */
    snapshot(admissionCycleId: string, now?: Date): Promise<DeadlineSnapshot>;
    /**
     * 마감을 넘겼으면 예외를 던진다.
     * 정책 mode 에 따라 비교 대상 시각이 달라진다.
     */
    assertWithinDeadline(admissionCycleId: string, input: DeadlineEvaluationInput): Promise<DeadlinePolicy>;
    /** 지금 적용 중인 정책. 판정을 트랜잭션 안에서 해야 할 때(접수 커밋 시각) 먼저 받아 둔다. */
    policyFor(admissionCycleId: string): Promise<DeadlinePolicy>;
    /** 이미 받은 정책으로 판정한다. DB 를 다시 읽지 않는다 — 트랜잭션 안에서 부를 수 있다. */
    assertEvaluated(policy: DeadlinePolicy, input: DeadlineEvaluationInput): void;
    /**
     * 정책이 인정하는 시각을 고른다.
     *
     * FINALIZED_COMMIT_BEFORE_DEADLINE   기본값. DB 커밋 시각
     * REQUEST_RECEIVED_BEFORE_DEADLINE   업무규정 명시 시. 요청 수신 시각
     * PAYMENT_APPROVED_BEFORE_DEADLINE   업무규정 명시 시. PG 승인 시각
     */
    effectiveAt(policy: DeadlinePolicy, input: DeadlineEvaluationInput): Date;
    /**
     * 활성화되지 않은 정책으로는 마감을 판정하지 않는다.
     * DDL 은 activated_at 을 NULL 허용으로 두므로 승인만 되고 미활성인 정책이 존재할 수 있다.
     */
    assertActivated(policy: DeadlinePolicy): void;
    /**
     * clock offset 이 허용범위를 넘으면 이 노드는 Finalize 를 수행하면 안 된다. (v1.1 §A9)
     * 측정값은 서버 시각 모듈(ClockMonitor)이 계속 잰다 — `assertFinalizationClock` 이 그 값을 넣는다.
     */
    assertClockHealthy(offsetMs: number): void;
    /**
     * 이 노드가 지금 접수를 확정해도 되는가 (§A9). 확실히 허용오차를 넘었을 때만 막는다 —
     * 아직 못 쟀거나(UNMEASURED) 측정이 오래된(STALE) 것은 막지 않는다. 그때는 커밋 시각을
     * DB 에 직접 물으므로 판정 자체는 틀리지 않고, DB 가 죽었다면 어차피 접수되지 않는다.
     * 상태는 접수 기록·감사에 그대로 남는다.
     */
    assertFinalizationClock(): void;
    /**
     * 가장 촘촘한 경고 단계를 고른다.
     * 남은 시간이 7분이면 10분 경고가 맞다. 30분 경고가 아니다.
     */
    private warningFor;
}
