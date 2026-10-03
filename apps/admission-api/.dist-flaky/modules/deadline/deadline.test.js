"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const deadline_policy_port_1 = require("./deadline-policy.port");
const deadline_service_1 = require("./deadline.service");
const DEADLINE = '2026-09-11T09:00:00.000Z'; // 실제 장애일의 마감시각을 기준으로 잡는다
function serviceWith(mode) {
    const port = new (class extends deadline_policy_port_1.DeadlinePolicyPort {
        async current() {
            return {
                version: 'test-v1',
                mode,
                deadlineAt: DEADLINE,
                approvedBy1: 'A',
                approvedBy2: 'B',
                approvedAt: '2026-09-01T00:00:00.000Z',
                activatedAt: '2026-09-01T00:00:00.000Z',
                policyHash: 'test-hash',
            };
        }
    })();
    return new deadline_service_1.DeadlineService(port);
}
const at = (iso) => new Date(iso);
(0, node_test_1.describe)('마감 경계값 (v1.1 §A2 — 마감 전후 ±5초)', () => {
    const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');
    (0, node_test_1.it)('마감 5초 전 커밋은 통과한다', async () => {
        await strict_1.default.doesNotReject(svc.assertWithinDeadline('c1', {
            requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
            commitAt: at('2026-09-11T08:59:55.000Z'),
        }));
    });
    (0, node_test_1.it)('마감 정각 커밋은 통과한다 (이하 포함)', async () => {
        await strict_1.default.doesNotReject(svc.assertWithinDeadline('c1', {
            requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
            commitAt: at(DEADLINE),
        }));
    });
    (0, node_test_1.it)('마감 1ms 후 커밋은 거부한다', async () => {
        await strict_1.default.rejects(svc.assertWithinDeadline('c1', {
            requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
            commitAt: at('2026-09-11T09:00:00.001Z'),
        }), (err) => err.problem?.status === 409 && err.problem.type.endsWith('/deadline-passed'));
    });
    (0, node_test_1.it)('마감 초과 응답에는 serverTime·deadlineAt·deadlinePolicyVersion·code 가 실린다', async () => {
        await svc
            .assertWithinDeadline('c1', {
            requestReceivedAt: at('2026-09-11T09:00:05.000Z'),
            commitAt: at('2026-09-11T09:00:05.000Z'),
        })
            .then(() => strict_1.default.fail('거부되어야 한다'), (err) => {
            strict_1.default.ok(err.problem.serverTime, 'serverTime 필요');
            strict_1.default.equal(err.problem.deadlineAt, DEADLINE);
            strict_1.default.equal(err.problem.deadlinePolicyVersion, 'test-v1');
            strict_1.default.equal(err.problem.code, 'DEADLINE_PASSED');
        });
    });
});
(0, node_test_1.describe)('정책 mode 별 인정 시각 (v1.1 §A2)', () => {
    const input = {
        requestReceivedAt: at('2026-09-11T08:59:58.000Z'), // 마감 전 도착
        paymentApprovedAt: at('2026-09-11T08:59:59.000Z'), // 마감 전 승인
        commitAt: at('2026-09-11T09:00:30.000Z'), // 커밋은 마감 후
    };
    (0, node_test_1.it)('기본 정책은 커밋 시각을 본다 — 이 경우 거부', async () => {
        const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');
        await strict_1.default.rejects(svc.assertWithinDeadline('c1', input));
    });
    (0, node_test_1.it)('요청 수신 기준 정책이면 통과한다', async () => {
        const svc = serviceWith('REQUEST_RECEIVED_BEFORE_DEADLINE');
        await strict_1.default.doesNotReject(svc.assertWithinDeadline('c1', input));
    });
    (0, node_test_1.it)('PG 승인 기준 정책이면 통과한다', async () => {
        const svc = serviceWith('PAYMENT_APPROVED_BEFORE_DEADLINE');
        await strict_1.default.doesNotReject(svc.assertWithinDeadline('c1', input));
    });
    (0, node_test_1.it)('PG 승인 시각이 없으면 커밋 시각으로 떨어뜨린다 — 없는 시각을 추정하지 않는다', async () => {
        const svc = serviceWith('PAYMENT_APPROVED_BEFORE_DEADLINE');
        await strict_1.default.rejects(svc.assertWithinDeadline('c1', {
            requestReceivedAt: input.requestReceivedAt,
            commitAt: input.commitAt,
        }));
    });
});
(0, node_test_1.describe)('마감 스냅샷', () => {
    const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');
    (0, node_test_1.it)('남은 시간 7분이면 10분 경고를 준다 (30분 아님)', async () => {
        const snap = await svc.snapshot('c1', at('2026-09-11T08:53:00.000Z'));
        strict_1.default.equal(snap.warningMinutes, 10);
    });
    (0, node_test_1.it)('남은 시간 45분이면 경고가 없다', async () => {
        const snap = await svc.snapshot('c1', at('2026-09-11T08:15:00.000Z'));
        strict_1.default.equal(snap.warningMinutes, null);
    });
    (0, node_test_1.it)('남은 시간 30초면 1분 경고를 준다', async () => {
        const snap = await svc.snapshot('c1', at('2026-09-11T08:59:30.000Z'));
        strict_1.default.equal(snap.warningMinutes, 1);
    });
    (0, node_test_1.it)('마감 후에는 passed=true 이고 경고가 없다', async () => {
        const snap = await svc.snapshot('c1', at('2026-09-11T09:00:01.000Z'));
        strict_1.default.equal(snap.passed, true);
        strict_1.default.equal(snap.warningMinutes, null);
    });
    (0, node_test_1.it)('스냅샷은 OpenAPI ServerTime 필수 필드를 만족한다', async () => {
        const snap = await svc.snapshot('c1', at('2026-09-11T08:00:00.000Z'));
        // required: [serverTime, deadlineAt, deadlinePolicyVersion]
        strict_1.default.ok(snap.serverTime);
        strict_1.default.equal(snap.deadlineAt, DEADLINE);
        strict_1.default.equal(snap.deadlinePolicyVersion, 'test-v1');
    });
});
(0, node_test_1.describe)('Clock drift (v1.1 §A9)', () => {
    const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');
    (0, node_test_1.it)('허용 오차 이내면 통과한다', () => {
        strict_1.default.doesNotThrow(() => svc.assertClockHealthy(deadline_service_1.MAX_CLOCK_OFFSET_MS - 1));
    });
    (0, node_test_1.it)('허용 오차를 넘으면 이 노드에서 처리하지 않는다', () => {
        strict_1.default.throws(() => svc.assertClockHealthy(deadline_service_1.MAX_CLOCK_OFFSET_MS + 1));
        strict_1.default.throws(() => svc.assertClockHealthy(-(deadline_service_1.MAX_CLOCK_OFFSET_MS + 1)));
    });
});
//# sourceMappingURL=deadline.test.js.map