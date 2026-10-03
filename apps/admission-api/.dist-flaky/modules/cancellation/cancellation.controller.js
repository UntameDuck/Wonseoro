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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const identity_1 = require("../../common/identity/identity");
const ownership_service_1 = require("../../common/identity/ownership.service");
const cancellation_service_1 = require("./cancellation.service");
/**
 * 원서 취소 — 불일치 대장 D-7
 *
 * ⚠️ canonical OpenAPI 에 없는 경로다. `kr.kadmission.application.cancelled.v1`
 * 이벤트와 `application.status = 'CANCELLED'` 는 계약에 있는데 **이르는 길이 없었다.**
 * 계약 추가가 필요하다.
 *
 * 취소는 되돌릴 수 없으므로 다른 mutation 과 같이 Idempotency-Key 를 요구한다.
 * 네트워크가 끊겨 재시도된 요청이 두 번째 취소로 처리되면 안 된다.
 */
let CancellationController = class CancellationController {
    cancellation;
    ownership;
    constructor(cancellation, ownership) {
        this.cancellation = cancellation;
        this.ownership = ownership;
    }
    async cancel(applicationId, body, req) {
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertApplication(applicationId, applicantId);
        const tp = req.headers.traceparent;
        const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
        return this.cancellation.cancel({
            applicationId,
            applicantId,
            reason: body?.reason ?? '',
            ...(traceId ? { traceId } : {}),
            ...(req.ip ? { sourceIp: req.ip } : {}),
        });
    }
};
exports.CancellationController = CancellationController;
__decorate([
    (0, common_1.Post)(':applicationId/cancel'),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], CancellationController.prototype, "cancel", null);
exports.CancellationController = CancellationController = __decorate([
    (0, common_1.Controller)('api/v1/applications'),
    __metadata("design:paramtypes", [cancellation_service_1.CancellationService,
        ownership_service_1.Ownership])
], CancellationController);
//# sourceMappingURL=cancellation.controller.js.map