/**
 * Peak Mode의 런타임 정책.
 *
 * HPA 전환은 GitOps 배포 자동화의 책임이다(D-48). 애플리케이션은 같은 예약 시각을
 * 읽어 피크 중 비핵심 내부 작업을 멈춘다. 두 경로가 같은 시각을 써야 확장 전에 DB를
 * 소비하는 배치가 다시 시작되는 틈이 없다.
 */
export type PeakModePolicy = Readonly<{
  enabled: boolean;
  scheduledActivationMs: number | null;
  suspendNonCriticalJobs: boolean;
}>;

/** Nest DI에서 인터페이스 타입 대신 쓰는 명시적 토큰. */
export const PEAK_MODE_POLICY = Symbol('PEAK_MODE_POLICY');

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parsePeakModeActivation(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (!RFC3339.test(text)) {
    throw new Error('PEAK_MODE_ACTIVATES_AT은 시간대가 포함된 RFC3339 시각이어야 한다');
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new Error('PEAK_MODE_ACTIVATES_AT을 유효한 시각으로 해석할 수 없다');
  }
  return parsed;
}

export function isPeakModeActive(policy: PeakModePolicy, nowMs: number = Date.now()): boolean {
  return policy.enabled ||
    (policy.scheduledActivationMs !== null && nowMs >= policy.scheduledActivationMs);
}

export function shouldSuspendNonCriticalJobs(
  policy: PeakModePolicy,
  nowMs: number = Date.now(),
): boolean {
  return policy.suspendNonCriticalJobs && isPeakModeActive(policy, nowMs);
}
