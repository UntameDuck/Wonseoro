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
exports.OperatingModeController = void 0;
const common_1 = require("@nestjs/common");
const central_health_gate_1 = require("./central-health.gate");
/**
 * GET /api/v1/meta/operating-mode — 자율 운영 배너의 근거. (v1.1 §A1 "운영배너와 Sync Lag 표시")
 *
 * 지원자 화면이 주기적으로 묻는다. 인증 없이 열려 있으므로 **개인정보도,
 * 운영 내부 정보도 싣지 않는다.** 실패(DEAD) 건수, 회로 상태, 실패 원인은
 * `/healthz/dependencies` 에만 있다.
 *
 * 메모리의 마지막 확인 결과만 돌려준다. 이 조회가 DB 나 중앙에 닿지 않는다.
 *
 * 계약에 없는 경로다. (D-34)
 */
let OperatingModeController = class OperatingModeController {
    gate;
    constructor(gate) {
        this.gate = gate;
    }
    operatingMode() {
        const s = this.gate.current();
        return {
            mode: s.mode,
            reason: s.reason,
            since: s.since,
            lastCentralContactAt: s.lastCentralContactAt,
            sync: {
                pendingEvents: s.sync.pendingEvents,
                oldestPendingAgeSeconds: s.sync.oldestPendingAgeSeconds,
                lagging: s.sync.lagging,
            },
            checkedAt: s.checkedAt,
            serverTime: new Date().toISOString(),
        };
    }
};
exports.OperatingModeController = OperatingModeController;
__decorate([
    (0, common_1.Get)('operating-mode'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OperatingModeController.prototype, "operatingMode", null);
exports.OperatingModeController = OperatingModeController = __decorate([
    (0, common_1.Controller)('api/v1/meta'),
    __metadata("design:paramtypes", [central_health_gate_1.CentralHealthGate])
], OperatingModeController);
//# sourceMappingURL=operating-mode.controller.js.map