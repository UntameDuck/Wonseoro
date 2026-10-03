/**
 * Peak Mode의 런타임 정책.
 *
 * HPA 전환은 GitOps 예약 자동화의 책임이다(D-48, ADR-0006). 애플리케이션은 같은 예약의
 * 억제 시각·종료 시각을 읽어 피크 중 비핵심 내부 작업만 멈춘다.
 *
 * - 억제 시각이 있으면 그 시각이 기준이다. `enabled`(사전 확장)가 먼저 켜져도 억제는 시각에 시작한다
 * - 억제 시각 없이 `enabled`만 켜면 즉시 억제한다 (운영자가 수동으로 켠 경우)
 * - 종료 시각이 지나면 억제를 푼다. 예약 자동화가 멈춰 overlay가 늦게 바뀌어도 대조가 영구히 멈추지 않는다
 */
export type PeakModePolicy = Readonly<{
    enabled: boolean;
    scheduledActivationMs: number | null;
    scheduledEndMs?: number | null;
    suspendNonCriticalJobs: boolean;
}>;
/** Nest DI에서 인터페이스 타입 대신 쓰는 명시적 토큰. */
export declare const PEAK_MODE_POLICY: unique symbol;
export declare function parsePeakModeActivation(value: string | undefined, name?: string): number | null;
/** 종료 시각은 억제 시각보다 뒤여야 한다. 거꾸로 된 예약은 기동을 막는다. */
export declare function parsePeakModeEnd(value: string | undefined, scheduledActivationMs: number | null): number | null;
export declare function isPeakModeActive(policy: PeakModePolicy, nowMs?: number): boolean;
export declare function shouldSuspendNonCriticalJobs(policy: PeakModePolicy, nowMs?: number): boolean;
