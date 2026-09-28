import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPeakModeActive,
  parsePeakModeActivation,
  shouldSuspendNonCriticalJobs,
} from './peak-mode';

describe('Peak Mode 런타임 정책 (T-M4-07)', () => {
  it('명시적으로 켜면 예약 시각 없이도 활성화한다', () => {
    assert.equal(isPeakModeActive({
      enabled: true,
      scheduledActivationMs: null,
      suspendNonCriticalJobs: true,
    }, 0), true);
  });

  it('예약 시각 전에는 비활성, 시각부터 활성이다', () => {
    const activation = parsePeakModeActivation('2026-09-11T03:00:00Z');
    const policy = {
      enabled: false,
      scheduledActivationMs: activation,
      suspendNonCriticalJobs: true,
    };
    assert.equal(isPeakModeActive(policy, activation! - 1), false);
    assert.equal(isPeakModeActive(policy, activation!), true);
    assert.equal(shouldSuspendNonCriticalJobs(policy, activation!), true);
  });

  it('억제 플래그가 꺼져 있으면 Peak Mode에서도 비핵심 작업을 멈추지 않는다', () => {
    assert.equal(shouldSuspendNonCriticalJobs({
      enabled: true,
      scheduledActivationMs: null,
      suspendNonCriticalJobs: false,
    }), false);
  });

  it('시간대가 없는 예약 시각은 거부한다', () => {
    assert.throws(
      () => parsePeakModeActivation('2026-09-11 03:00:00'),
      /RFC3339/,
    );
  });
});
