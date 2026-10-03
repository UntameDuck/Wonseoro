"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const common_1 = require("@nestjs/common");
const problem_exception_1 = require("../problem/problem.exception");
const business_metrics_1 = require("./business-metrics");
(0, node_test_1.describe)('업무 KPI 결과 분류 (T-M4-22)', () => {
    (0, node_test_1.it)('업무 검증 거절(4xx)은 시스템 실패가 아니다 — 성공률 분모에서 빠진다', () => {
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(problem_exception_1.ProblemException.validationFailed('필수값')), 'rejected');
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(new common_1.HttpException('not found', 404)), 'rejected');
    });
    (0, node_test_1.it)('If-Match 불일치·경합은 충돌로 센다', () => {
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(new common_1.HttpException('precondition', 412)), 'conflict');
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(new common_1.HttpException('conflict', 409)), 'conflict');
    });
    (0, node_test_1.it)('5xx·예상 밖 예외는 오류다', () => {
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(new common_1.HttpException('boom', 503)), 'error');
        strict_1.default.equal((0, business_metrics_1.classifyFailure)(new Error('db down')), 'error');
    });
    (0, node_test_1.it)('추적 래퍼는 결과·예외를 그대로 넘긴다', async () => {
        strict_1.default.equal(await (0, business_metrics_1.trackDraftSave)(async () => 7), 7);
        await strict_1.default.rejects((0, business_metrics_1.trackDraftSave)(async () => { throw new Error('x'); }), /x/);
        const finalized = await (0, business_metrics_1.trackFinalize)('applicant', async () => ({ created: false, id: 1 }));
        strict_1.default.deepEqual(finalized, { created: false, id: 1 });
        const row = await (0, business_metrics_1.trackPaymentVerify)(async () => ({ row: { status: 'CONFIRMED' }, unverified: false }));
        strict_1.default.equal(row.status, 'CONFIRMED');
    });
});
//# sourceMappingURL=business-metrics.test.js.map