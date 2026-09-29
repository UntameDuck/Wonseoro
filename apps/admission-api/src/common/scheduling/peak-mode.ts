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
export const PEAK_MODE_POLICY = Symbol('PEAK_MODE_POLICY');

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parsePeakModeActivation(
  value: string | undefined,
  name = 'PEAK_MODE_ACTIVATES_AT',
): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (!RFC3339.test(text)) {
    throw new Error(`${name}은 시간대가 포함된 RFC3339 시각이어야 한다`);
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name}을 유효한 시각으로 해석할 수 없다`);
  }
  return parsed;
}

/** 종료 시각은 억제 시각보다 뒤여야 한다. 거꾸로 된 예약은 기동을 막는다. */
export function parsePeakModeEnd(
  value: string | undefined,
  scheduledActivationMs: number | null,
): number | null {
  const end = parsePeakModeActivation(value, 'PEAK_MODE_ENDS_AT');
  if (end !== null && scheduledActivationMs !== null && end <= scheduledActivationMs) {
    throw new Error('PEAK_MODE_ENDS_AT은 PEAK_MODE_ACTIVATES_AT보다 뒤여야 한다');
  }
  return end;
}

export function isPeakModeActive(policy: PeakModePolicy, nowMs: number = Date.now()): boolean {
  const end = policy.scheduledEndMs ?? null;
  if (end !== null && nowMs >= end) return false;
  if (policy.scheduledActivationMs !== null) return nowMs >= policy.scheduledActivationMs;
  return policy.enabled;
}

export function shouldSuspendNonCriticalJobs(
  policy: PeakModePolicy,
  nowMs: number = Date.now(),
): boolean {
  return policy.suspendNonCriticalJobs && isPeakModeActive(policy, nowMs);
}
