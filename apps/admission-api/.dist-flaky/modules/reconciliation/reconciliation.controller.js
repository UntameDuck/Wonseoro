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
exports.ReconciliationController = void 0;
const common_1 = require("@nestjs/common");
const admin_guard_1 = require("../../common/identity/admin.guard");
const admin_scope_1 = require("../../common/identity/admin-scope");
const identity_1 = require("../../common/identity/identity");
const problem_exception_1 = require("../../common/problem/problem.exception");
const reconciliation_service_1 = require("./reconciliation.service");
/**
 * Reconciliation Center — canonical: k-admission-openapi.yaml
 *   listReconciliationExceptions / resolveReconciliationException
 *
 * ⚠️ `POST /admin/v1/reconciliation/run` 은 계약에 없다.
 * D+1 배치를 스케줄러로 돌리더라도 **수동 트리거가 있어야 한다** —
 * 장애 중에 운영자가 즉시 대조를 돌려야 하는 상황이 실제로 생긴다. (D-26)
 */
/** D+1 배치 기준. §B18 */
const DEFAULT_SINCE_HOURS = 48;
/** 한 번의 대조가 훑을 수 있는 최대 범위. 30일. */
const MAX_SINCE_HOURS = 24 * 30;
let ReconciliationController = class ReconciliationController {
    reconciliation;
    constructor(reconciliation) {
        this.reconciliation = reconciliation;
    }
    async list(state) {
        const valid = [
            'OPEN',
            'MANUAL_REVIEW',
            'RESOLVED',
            'AUTO_RESOLVED',
            'ALL',
        ];
        const s = (state ?? 'OPEN');
        if (!valid.includes(s)) {
            throw problem_exception_1.ProblemException.validationFailed(`state 는 ${valid.join(' / ')} 중 하나여야 합니다.`);
        }
        return { exceptions: await this.reconciliation.list(s) };
    }
    async run(body) {
        // 범위를 열어두면 대조 한 번이 전체 이력을 훑어 DB 를 묶는다.
        // 장애 중에 부르는 API 라 더 위험하다.
        const sinceHours = body?.sinceHours ?? DEFAULT_SINCE_HOURS;
        if (!Number.isInteger(sinceHours) || sinceHours < 1 || sinceHours > MAX_SINCE_HOURS) {
            throw problem_exception_1.ProblemException.validationFailed(`대조 기간은 1시간 이상 ${MAX_SINCE_HOURS}시간 이하로 정해 주십시오.`);
        }
        return this.reconciliation.reconcile(sinceHours);
    }
    async resolve(exceptionId, body, req) {
        return this.reconciliation.resolve(exceptionId, (0, identity_1.adminFrom)(req).adminId, body?.resolutionCode ?? '', body?.reason ?? '');
    }
};
exports.ReconciliationController = ReconciliationController;
__decorate([
    (0, common_1.Get)('exceptions'),
    (0, admin_scope_1.AdminScope)('operator'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('state')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReconciliationController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('run'),
    (0, admin_scope_1.AdminScope)('operator'),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReconciliationController.prototype, "run", null);
__decorate([
    (0, common_1.Post)(':exceptionId/resolve'),
    (0, admin_scope_1.AdminScope)('admin'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('exceptionId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ReconciliationController.prototype, "resolve", null);
exports.ReconciliationController = ReconciliationController = __decorate([
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.Controller)('admin/v1/reconciliation'),
    __metadata("design:paramtypes", [reconciliation_service_1.ReconciliationService])
], ReconciliationController);
//# sourceMappingURL=reconciliation.controller.js.map