"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DeadlineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadlineService = exports.MAX_CLOCK_OFFSET_MS = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const problem_exception_1 = require("../../common/problem/problem.exception");
const server_clock_1 = require("../../common/time/server-clock");
Object.defineProperty(exports, "MAX_CLOCK_OFFSET_MS", { enumerable: true, get: function () { return server_clock_1.MAX_CLOCK_OFFSET_MS; } });
const deadline_policy_port_1 = require("./deadline-policy.port");
/**
 * 마감 판정 — 기술설계서 v1.1 §A2
 *
 * 절대 규칙
 *   1. 브라우저가 보낸 시각을 쓰지 않는다. 서버 시각만 쓴다.
 *   2. 마감 시각을 코드 상수로 박지 않는다. 정책 객체에서 읽는다.
 *   3. 마감 관련 오류 응답에는 serverTime·deadlineAt·deadlinePolicyVersion 을 반드시 싣는다.
 *   4. 어느 시점을 "기한 내"로 인정할지는 업무규정이 정한다. 개발자가 정하지 않는다.
 */
let DeadlineService = DeadlineService_1 = class DeadlineService {
    policies;
    logger = new common_1.Logger(DeadlineService_1.name);
    constructor(policies) {
        this.policies = policies;
    }
    /**
     * 화면 표시용 스냅샷. GET /api/v1/meta/time 과 모든 원서 응답에 싣는다.
     * 서버 시각은 DB 시계에 맞춘 값이고(§A2), 이 노드가 잰 offset 을 함께 준다(§A9).
     */
    async snapshot(admissionCycleId, now = (0, server_clock_1.serverNow)()) {
        const policy = await this.policies.current(admissionCycleId);
        const deadline = new Date(policy.deadlineAt);
        const remainingMs = deadline.getTime() - now.getTime();
        return {
            serverTime: now.toISOString(),
            deadlineAt: policy.deadlineAt,
            deadlinePolicyVersion: policy.version,
            clockOffsetMs: server_clock_1.serverClock.reading().offsetMs,
            remainingMs,
            warningMinutes: this.warningFor(remainingMs),
            passed: remainingMs <= 0,
        };
    }
    /**
     * 마감을 넘겼으면 예외를 던진다.
     * 정책 mode 에 따라 비교 대상 시각이 달라진다.
     */
    async assertWithinDeadline(admissionCycleId, input) {
        const policy = await this.policies.current(admissionCycleId);
        this.assertEvaluated(policy, input);
        return policy;
    }
    /** 지금 적용 중인 정책. 판정을 트랜잭션 안에서 해야 할 때(접수 커밋 시각) 먼저 받아 둔다. */
    async policyFor(admissionCycleId) {
        return this.policies.current(admissionCycleId);
    }
    /** 이미 받은 정책으로 판정한다. DB 를 다시 읽지 않는다 — 트랜잭션 안에서 부를 수 있다. */
    assertEvaluated(policy, input) {
        const deadline = new Date(policy.deadlineAt);
        const effectiveAt = this.effectiveAt(policy, input);
        if (effectiveAt.getTime() > deadline.getTime()) {
            throw problem_exception_1.ProblemException.deadlinePassed({
                serverTime: (0, server_clock_1.serverNow)().toISOString(),
                deadlineAt: policy.deadlineAt,
                deadlinePolicyVersion: policy.version,
            });
        }
    }
    /**
     * 정책이 인정하는 시각을 고른다.
     *
     * FINALIZED_COMMIT_BEFORE_DEADLINE   기본값. DB 커밋 시각
     * REQUEST_RECEIVED_BEFORE_DEADLINE   업무규정 명시 시. 요청 수신 시각
     * PAYMENT_APPROVED_BEFORE_DEADLINE   업무규정 명시 시. PG 승인 시각
     */
    effectiveAt(policy, input) {
        switch (policy.mode) {
            case 'REQUEST_RECEIVED_BEFORE_DEADLINE':
                return input.requestReceivedAt;
            case 'PAYMENT_APPROVED_BEFORE_DEADLINE':
                // 결제 승인 시각이 없으면 안전한 쪽(커밋 시각)으로 떨어뜨린다.
                // 없는 시각을 마감 내로 추정하지 않는다.
                return input.paymentApprovedAt ?? input.commitAt;
            case 'FINALIZED_COMMIT_BEFORE_DEADLINE':
            default:
                return input.commitAt;
        }
    }
    /**
     * 활성화되지 않은 정책으로는 마감을 판정하지 않는다.
     * DDL 은 activated_at 을 NULL 허용으로 두므로 승인만 되고 미활성인 정책이 존재할 수 있다.
     */
    assertActivated(policy) {
        if (!policy.activatedAt) {
            throw problem_exception_1.ProblemException.retryable('활성화된 마감 정책이 없어 요청을 처리할 수 없습니다.');
        }
    }
    /**
     * clock offset 이 허용범위를 넘으면 이 노드는 Finalize 를 수행하면 안 된다. (v1.1 §A9)
     * 측정값은 서버 시각 모듈(ClockMonitor)이 계속 잰다 — `assertFinalizationClock` 이 그 값을 넣는다.
     */
    assertClockHealthy(offsetMs) {
        if (Math.abs(offsetMs) > server_clock_1.MAX_CLOCK_OFFSET_MS) {
            this.logger.error(`clock offset ${offsetMs}ms exceeds ${server_clock_1.MAX_CLOCK_OFFSET_MS}ms`);
            throw problem_exception_1.ProblemException.retryable('서버 시각 동기화에 문제가 있어 요청을 처리할 수 없습니다.');
        }
    }
    /**
     * 이 노드가 지금 접수를 확정해도 되는가 (§A9). 확실히 허용오차를 넘었을 때만 막는다 —
     * 아직 못 쟀거나(UNMEASURED) 측정이 오래된(STALE) 것은 막지 않는다. 그때는 커밋 시각을
     * DB 에 직접 물으므로 판정 자체는 틀리지 않고, DB 가 죽었다면 어차피 접수되지 않는다.
     * 상태는 접수 기록·감사에 그대로 남는다.
     */
    assertFinalizationClock() {
        const reading = server_clock_1.serverClock.reading();
        if (reading.status === 'OFFSET_EXCEEDED')
            this.assertClockHealthy(reading.offsetMs);
    }
    /**
     * 가장 촘촘한 경고 단계를 고른다.
     * 남은 시간이 7분이면 10분 경고가 맞다. 30분 경고가 아니다.
     */
    warningFor(remainingMs) {
        if (remainingMs <= 0)
            return null;
        const remainingMinutes = remainingMs / 60_000;
        const ascending = [...contracts_1.DEADLINE_WARNING_MINUTES].sort((a, b) => a - b);
        for (const minutes of ascending) {
            if (remainingMinutes <= minutes)
                return minutes;
        }
        return null;
    }
};
exports.DeadlineService = DeadlineService;
exports.DeadlineService = DeadlineService = DeadlineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [deadline_policy_port_1.DeadlinePolicyPort])
], DeadlineService);
//# sourceMappingURL=deadline.service.js.map