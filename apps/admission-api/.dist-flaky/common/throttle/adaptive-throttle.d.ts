/**
 * Adaptive Throttling — 기술설계서 v1.1 §01 B6, v1.0 §8.4, STRIDE D-02 (T-M4-40)
 *
 * 한 고등학교 전체가 같은 공인 IP 로 나온다. IP 로 막으면 정상 수험생이 통째로 막힌다.
 * 그래서 **IP 는 키로 쓰지 않는다.** 키는 인증된 지원자(세션·계정)다. 원서 단위 신호는 위험점수로 들어간다.
 *
 *   1. 지원자 × 요청 종류마다 토큰 버킷 — 사람의 정상 속도(자동저장 몇 초에 한 번)보다 넉넉하다
 *   2. 위험점수(0~100) — 남의 원서 조회 실패(404/403), 짧은 시간에 여러 원서 훑기, 한도 초과가 올리고 시간이 내린다
 *   3. 점수가 오르면 충전 속도를 줄이고, 높으면 변경 요청을 멈춘다(RISK). 조회는 계속 된다
 *   4. **최종제출은 정상 세션에서 절대 막지 않는다** (§8.4). 위험이 높을 때만 넉넉한 별도 한도를 둔다 —
 *      Finalize 는 멱등이라 재시도가 중복 접수가 되지 않는다
 *
 * 상태는 Pod 메모리에 둔다. 접수 경로에 새 의존성(Redis)을 넣지 않기 위해서다 — Pod 가 N 개면 한 지원자의
 * 실효 한도는 최대 N 배가 된다. 한도는 그걸 알고 정했다 (ADR-0007). 판정은 순수 함수라 시계를 주입해 시험한다.
 */
export type RequestClass = 'read' | 'save' | 'create' | 'upload' | 'payment' | 'cancel' | 'finalize';
export interface BucketSpec {
    /** 한 번에 몰아 쓸 수 있는 요청 수 */
    capacity: number;
    /** 초당 다시 채워지는 요청 수 */
    refillPerSecond: number;
}
/**
 * 지원자 한 명 · Pod 하나 기준. 사람의 정상 사용 대비 여유:
 *   자동저장은 보통 3~5초에 한 번(0.2~0.33/s) → save 0.5/s·30 버스트
 *   원서 화면 열기는 요청 10여 개 → read 2/s·120 버스트
 *   원서 생성은 전형마다 한 번 → create 30초에 1개·10 버스트
 */
export declare const DEFAULT_LIMITS: Record<Exclude<RequestClass, 'finalize'>, BucketSpec> & {
    finalize: BucketSpec;
};
export declare const RISK: {
    /** 이 이상이면 충전 속도를 절반으로 */
    readonly elevated: 30;
    /** 이 이상이면 변경 요청을 멈춘다 */
    readonly high: 70;
    readonly max: 100;
    /** 반감기 */
    readonly halfLifeMs: number;
    /** 남의 원서·없는 원서를 찾다 실패 (BOLA 탐색) */
    readonly ownershipMiss: 10;
    /** 한도를 넘겨 거절됨 — 스스로 계속 올라가지 않게 작게 */
    readonly throttled: 5;
    /** 이 개수를 넘는 원서를 짧은 시간에 건드림 — 한 지원자는 전형 수만큼(수시 최대 6)만 갖는다 */
    readonly distinctApplicationsAllowed: 6;
    readonly distinctApplicationsWindowMs: number;
    readonly manyApplications: 20;
};
export type Decision = {
    allowed: true;
} | {
    allowed: false;
    reason: 'BURST' | 'RISK';
    retryAfterSeconds: number;
};
export interface ThrottleOptions {
    limits?: typeof DEFAULT_LIMITS;
    /** 추적하는 지원자 수 상한 — 넘으면 가장 오래 안 본 지원자부터 잊는다 (메모리 상한) */
    maxSubjects?: number;
    now?: () => number;
}
export declare class AdaptiveThrottle {
    private readonly subjects;
    private readonly limits;
    private readonly maxSubjects;
    private readonly now;
    constructor(options?: ThrottleOptions);
    get trackedSubjects(): number;
    /** 요청을 받기 전에 묻는다. 허용되면 토큰을 하나 쓴다. */
    check(subject: string, cls: RequestClass, applicationId?: string): Decision;
    /**
     * 소유권 검사 실패 — 남의 원서(또는 없는 원서)를 찾았다. 식별자를 바꿔 가며 훑는 탐색(BOLA)의 신호다.
     * "아직 접수증 없음" 같은 정상 404 는 세지 않는다 — 그래서 응답 코드가 아니라 소유권 검사에서 직접 부른다.
     */
    noteOwnershipMiss(subject: string): void;
    /**
     * 본인확인 다시 하기로 위험 차단을 푼다 (ADR-0009, T-M5-02 단계 6).
     *
     * 사람이 차단이 시작된 **뒤에** 다시 직접 인증했다면(토큰의 auth_time) 자동화가 아니라고 본다 — 접근성 기준을 통과한
     * 본인확인 수단이 퍼즐형 CAPTCHA 의 "사람 확인" 을 대신한다. 같은 인증으로는 한 번만 푼다: 풀린 뒤 다시 남용해 점수가
     * 오르면 또 막히고, 그때는 새로 본인확인해야 한다.
     * @returns 풀었으면 true
     */
    releaseRiskByReauth(subject: string, authTimeMs: number): boolean;
    riskOf(subject: string): number;
    private state;
    private currentRisk;
    private raise;
    private touchApplication;
}
/**
 * 경로 템플릿 → 요청 종류. null 이면 이 계층이 보지 않는다:
 *   헬스·관리자(별도 인증·망)·내부 경로·PG 콜백(서명 검증)·익명 공개 조회(카탈로그·서버 시각 — Edge 캐시·WAF 몫)
 */
export declare function classifyRoute(method: string, route: string | undefined): RequestClass | null;
