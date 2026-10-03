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
exports.EvidenceController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const admin_guard_1 = require("../../common/identity/admin.guard");
const admin_scope_1 = require("../../common/identity/admin-scope");
const identity_1 = require("../../common/identity/identity");
const evidence_service_1 = require("./evidence.service");
/**
 * Evidence Package — canonical: k-admission-openapi.yaml
 *   getEvidencePackage, security: [{ oidc: [auditor] }]
 *
 * oidc 모드: security-auditor 역할 + 비밀번호·OTP + **방금 한 인증**(Step-up)이어야 연다 (T-M5-10).
 * 그 밖의 모드: AdminGuard 의 공유 비밀, `x-admin-id` 는 열람자 기록용이다.
 *
 * **조회 사유가 필수다.** (§8.3)
 * 증적 열람은 그 자체로 감사 대상이고, 누가 왜 봤는지가 남아야 한다.
 * 계약에는 사유 파라미터가 없으므로 추가했다. (불일치 대장 D-24)
 */
let EvidenceController = class EvidenceController {
    evidence;
    constructor(evidence) {
        this.evidence = evidence;
    }
    async get(applicationId, req, reason) {
        return this.evidence.generate(applicationId, (0, identity_1.adminFrom)(req).adminId, reason ?? '');
    }
};
exports.EvidenceController = EvidenceController;
__decorate([
    (0, common_1.Get)('applications/:applicationId'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Query)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], EvidenceController.prototype, "get", null);
exports.EvidenceController = EvidenceController = __decorate([
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, admin_scope_1.AdminScope)('auditor'),
    (0, common_1.Controller)('admin/v1/evidence'),
    __metadata("design:paramtypes", [evidence_service_1.EvidenceService])
], EvidenceController);
//# sourceMappingURL=evidence.controller.js.map