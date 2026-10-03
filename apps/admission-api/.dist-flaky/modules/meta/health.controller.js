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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const server_clock_1 = require("../../common/time/server-clock");
/**
 * K-PaaS/Kubernetes probe. (v1.1 §05 — startup/readiness/liveness 필수)
 *
 * liveness 는 프로세스 생존만 본다. DB 가 죽었다고 Pod 를 죽이면
 * DB Failover 중에 전체 Pod 가 재시작되어 상황이 더 나빠진다.
 * readiness 만 DB 를 확인해 트래픽에서 빠진다.
 */
let HealthController = class HealthController {
    db;
    breakers;
    constructor(db, breakers) {
        this.db = db;
        this.breakers = breakers;
    }
    live() {
        return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
    }
    async ready() {
        if (!(await this.db.healthy())) {
            throw problem_exception_1.ProblemException.retryable('데이터베이스에 연결할 수 없습니다.');
        }
        return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
    }
    /**
     * 외부 의존성 Circuit Breaker 상태. (v1.1 §01 C8)
     *
     * **readiness 에 넣지 않는다.** 중앙이나 PG 가 죽었다고 readyz 가 실패하면
     * 모든 Pod 가 트래픽에서 빠져 접수 전체가 멈춘다. 끊는 이유가 바로 그걸 막는 것이다.
     * 여기서는 관제가 "무엇이 끊겼는가"를 볼 수 있게만 한다.
     *
     * Pod 마다 따로 판단하므로 이 값은 **이 Pod** 의 상태다.
     */
    dependencies() {
        const circuits = this.breakers.snapshot();
        // 시각 상태도 같은 이유로 readiness 에 넣지 않는다. 허용오차를 넘은 노드는 Finalize 만
        // 거절한다 — 작성·저장·조회까지 트래픽에서 빼면 접수 전체가 줄어든다. (§A9)
        const clock = server_clock_1.serverClock.reading();
        return {
            service: 'admission-api',
            degraded: circuits.some((c) => c.state !== 'CLOSED') || clock.status === 'OFFSET_EXCEEDED',
            circuits,
            clock,
            time: new Date().toISOString(),
        };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)('healthz'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
__decorate([
    (0, common_1.Get)('readyz'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
__decorate([
    (0, common_1.Get)('healthz/dependencies'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "dependencies", null);
exports.HealthController = HealthController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        dependency_breakers_1.DependencyBreakers])
], HealthController);
//# sourceMappingURL=health.controller.js.map