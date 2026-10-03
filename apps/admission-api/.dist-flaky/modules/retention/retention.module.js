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
exports.RetentionModule = exports.RetentionController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const admin_guard_1 = require("../../common/identity/admin.guard");
const admin_scope_1 = require("../../common/identity/admin-scope");
const problem_exception_1 = require("../../common/problem/problem.exception");
const retention_service_1 = require("./retention.service");
/**
 * Retention Matrix 조회 — v1.1 §A15 (T-M3-10)
 *
 * 보존정책 **설정**은 여기 없다. Config 의 `retention` 섹션으로 들어가서
 * 2인 승인·Diff·서명된 적용 기록을 그대로 탄다. 보존기간을 줄이는 것은 파기를
 * 앞당기는 일이라 Diff 에서 DESTRUCTIVE 로 보인다.
 *
 * 계약: OpenAPI getRetentionMatrix · getRetentionPlan (D-38). 관리자 콘솔 `/retention` 이 보여 준다.
 */
let RetentionController = class RetentionController {
    retention;
    constructor(retention) {
        this.retention = retention;
    }
    /** 데이터 종류별 하한과 근거. 설정 화면이 이것을 보고 입력칸을 그린다. */
    matrix() {
        return { categories: contracts_1.RETENTION_CATEGORIES };
    }
    /** 지금 적용 중인 정책으로 무엇이 언제 파기 대상인가. 지우지 않는다. */
    async plan(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        return this.retention.plan(cycleId);
    }
};
exports.RetentionController = RetentionController;
__decorate([
    (0, common_1.Get)('matrix'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RetentionController.prototype, "matrix", null);
__decorate([
    (0, common_1.Get)('plan'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RetentionController.prototype, "plan", null);
exports.RetentionController = RetentionController = __decorate([
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, admin_scope_1.AdminScope)('admin'),
    (0, common_1.Controller)('admin/v1/retention'),
    __metadata("design:paramtypes", [retention_service_1.RetentionService])
], RetentionController);
let RetentionModule = class RetentionModule {
};
exports.RetentionModule = RetentionModule;
exports.RetentionModule = RetentionModule = __decorate([
    (0, common_1.Module)({
        controllers: [RetentionController],
        providers: [retention_service_1.RetentionService],
    })
], RetentionModule);
//# sourceMappingURL=retention.module.js.map