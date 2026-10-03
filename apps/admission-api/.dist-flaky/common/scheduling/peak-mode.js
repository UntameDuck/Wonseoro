"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PEAK_MODE_POLICY = void 0;
exports.parsePeakModeActivation = parsePeakModeActivation;
exports.parsePeakModeEnd = parsePeakModeEnd;
exports.isPeakModeActive = isPeakModeActive;
exports.shouldSuspendNonCriticalJobs = shouldSuspendNonCriticalJobs;
/** Nest DI에서 인터페이스 타입 대신 쓰는 명시적 토큰. */
exports.PEAK_MODE_POLICY = Symbol('PEAK_MODE_POLICY');
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function parsePeakModeActivation(value, name = 'PEAK_MODE_ACTIVATES_AT') {
    const text = value?.trim();
    if (!text)
        return null;
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
function parsePeakModeEnd(value, scheduledActivationMs) {
    const end = parsePeakModeActivation(value, 'PEAK_MODE_ENDS_AT');
    if (end !== null && scheduledActivationMs !== null && end <= scheduledActivationMs) {
        throw new Error('PEAK_MODE_ENDS_AT은 PEAK_MODE_ACTIVATES_AT보다 뒤여야 한다');
    }
    return end;
}
function isPeakModeActive(policy, nowMs = Date.now()) {
    const end = policy.scheduledEndMs ?? null;
    if (end !== null && nowMs >= end)
        return false;
    if (policy.scheduledActivationMs !== null)
        return nowMs >= policy.scheduledActivationMs;
    return policy.enabled;
}
function shouldSuspendNonCriticalJobs(policy, nowMs = Date.now()) {
    return policy.suspendNonCriticalJobs && isPeakModeActive(policy, nowMs);
}
//# sourceMappingURL=peak-mode.js.map