"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const peak_mode_1 = require("./peak-mode");
(0, node_test_1.describe)('Peak Mode 런타임 정책 (T-M4-07)', () => {
    (0, node_test_1.it)('명시적으로 켜면 예약 시각 없이도 활성화한다', () => {
        strict_1.default.equal((0, peak_mode_1.isPeakModeActive)({
            enabled: true,
            scheduledActivationMs: null,
            suspendNonCriticalJobs: true,
        }, 0), true);
    });
    (0, node_test_1.it)('예약 시각 전에는 비활성, 시각부터 활성이다', () => {
        const activation = (0, peak_mode_1.parsePeakModeActivation)('2026-09-11T03:00:00Z');
        const policy = {
            enabled: false,
            scheduledActivationMs: activation,
            suspendNonCriticalJobs: true,
        };
        strict_1.default.equal((0, peak_mode_1.isPeakModeActive)(policy, activation - 1), false);
        strict_1.default.equal((0, peak_mode_1.isPeakModeActive)(policy, activation), true);
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)(policy, activation), true);
    });
    (0, node_test_1.it)('억제 플래그가 꺼져 있으면 Peak Mode에서도 비핵심 작업을 멈추지 않는다', () => {
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)({
            enabled: true,
            scheduledActivationMs: null,
            suspendNonCriticalJobs: false,
        }), false);
    });
    (0, node_test_1.it)('사전 확장(enabled)이 먼저 켜져도 억제는 예약 억제 시각에 시작한다 (D-48)', () => {
        const activation = (0, peak_mode_1.parsePeakModeActivation)('2026-09-09T12:00:00+09:00');
        const policy = { enabled: true, scheduledActivationMs: activation, suspendNonCriticalJobs: true };
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)(policy, activation - 1), false);
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)(policy, activation), true);
    });
    (0, node_test_1.it)('종료 시각이 지나면 overlay가 늦게 바뀌어도 억제를 푼다', () => {
        const activation = (0, peak_mode_1.parsePeakModeActivation)('2026-09-09T12:00:00+09:00');
        const end = (0, peak_mode_1.parsePeakModeEnd)('2026-09-10T06:00:00+09:00', activation);
        const policy = {
            enabled: true,
            scheduledActivationMs: activation,
            scheduledEndMs: end,
            suspendNonCriticalJobs: true,
        };
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)(policy, end - 1), true);
        strict_1.default.equal((0, peak_mode_1.shouldSuspendNonCriticalJobs)(policy, end), false);
        strict_1.default.equal((0, peak_mode_1.isPeakModeActive)({ ...policy, scheduledActivationMs: null }, end), false);
    });
    (0, node_test_1.it)('종료 시각이 억제 시각보다 앞서면 기동을 막는다', () => {
        const activation = (0, peak_mode_1.parsePeakModeActivation)('2026-09-09T12:00:00Z');
        strict_1.default.throws(() => (0, peak_mode_1.parsePeakModeEnd)('2026-09-09T12:00:00Z', activation), /뒤여야/);
        strict_1.default.equal((0, peak_mode_1.parsePeakModeEnd)('', activation), null);
        strict_1.default.throws(() => (0, peak_mode_1.parsePeakModeEnd)('2026-09-10', activation), /PEAK_MODE_ENDS_AT.*RFC3339/);
    });
    (0, node_test_1.it)('시간대가 없는 예약 시각은 거부한다', () => {
        strict_1.default.throws(() => (0, peak_mode_1.parsePeakModeActivation)('2026-09-11 03:00:00'), /RFC3339/);
    });
});
//# sourceMappingURL=peak-mode.test.js.map