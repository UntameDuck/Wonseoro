import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPeakModeActive,
  parsePeakModeActivation,
  parsePeakModeEnd,
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

  it('사전 확장(enabled)이 먼저 켜져도 억제는 예약 억제 시각에 시작한다 (D-48)', () => {
    const activation = parsePeakModeActivation('2026-09-09T12:00:00+09:00')!;
    const policy = { enabled: true, scheduledActivationMs: activation, suspendNonCriticalJobs: true };
    assert.equal(shouldSuspendNonCriticalJobs(policy, activation - 1), false);
    assert.equal(shouldSuspendNonCriticalJobs(policy, activation), true);
  });

  it('종료 시각이 지나면 overlay가 늦게 바뀌어도 억제를 푼다', () => {
    const activation = parsePeakModeActivation('2026-09-09T12:00:00+09:00')!;
    const end = parsePeakModeEnd('2026-09-10T06:00:00+09:00', activation)!;
    const policy = {
      enabled: true,
      scheduledActivationMs: activation,
      scheduledEndMs: end,
      suspendNonCriticalJobs: true,
    };
    assert.equal(shouldSuspendNonCriticalJobs(policy, end - 1), true);
    assert.equal(shouldSuspendNonCriticalJobs(policy, end), false);
    assert.equal(isPeakModeActive({ ...policy, scheduledActivationMs: null }, end), false);
  });

  it('종료 시각이 억제 시각보다 앞서면 기동을 막는다', () => {
    const activation = parsePeakModeActivation('2026-09-09T12:00:00Z');
    assert.throws(() => parsePeakModeEnd('2026-09-09T12:00:00Z', activation), /뒤여야/);
    assert.equal(parsePeakModeEnd('', activation), null);
    assert.throws(() => parsePeakModeEnd('2026-09-10', activation), /PEAK_MODE_ENDS_AT.*RFC3339/);
  });

  it('시간대가 없는 예약 시각은 거부한다', () => {
    assert.throws(
      () => parsePeakModeActivation('2026-09-11 03:00:00'),
      /RFC3339/,
    );
  });
});
