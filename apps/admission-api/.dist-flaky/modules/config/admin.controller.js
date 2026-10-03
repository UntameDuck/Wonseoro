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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const admin_guard_1 = require("../../common/identity/admin.guard");
const admin_scope_1 = require("../../common/identity/admin-scope");
const identity_1 = require("../../common/identity/identity");
const problem_exception_1 = require("../../common/problem/problem.exception");
const activation_recorder_1 = require("../activation/activation-recorder");
const deadline_policy_repository_1 = require("../deadline/deadline-policy.repository");
const config_version_service_1 = require("./config-version.service");
/**
 * 입학처 관리자 API — canonical: k-admission-openapi.yaml `/admin/v1/*`
 *
 * 기술설계서 v1.1 §A14·§C5, §01 E
 * **"단독 운영자 1명으로 마감시간 변경 불가"** 가 이 컨트롤러의 존재 이유다.
 *
 * ⚠️ 인증은 M5 다. (T-M5-10 Admin MFA + Step-up)
 * 그때까지는 AdminGuard 의 공유 비밀이 문을 지키고, `x-admin-id` 는 감사 기록용으로만 쓴다.
 * 공유 비밀은 누가 했는지 구분하지 못한다 — 문과 기록은 다른 문제다.
 *
 * `deadline-policies/{id}/activate`(D-22)·`deadline-policies/extensions`·`activations`(D-35) 는
 * 구현이 먼저 만들고 계약 v1.2.0 에 올렸다.
 *
 * 활성화·연장·되돌리기는 전부 **서명된 기록**으로 남는다. 누가 했는지는 `x-admin-id`
 * 에서 온다 — 공유 비밀 뒤라 신원 증명은 아니지만, 두 명의 서로 다른 승인자가
 * 서명된 기록에 함께 묶이므로 "한 사람이 혼자 바꿨다" 는 구별된다. (역할 분리는 T-M5-10)
 */
let AdminController = class AdminController {
    configs;
    policies;
    activations;
    constructor(configs, policies, activations) {
        this.configs = configs;
        this.policies = policies;
        this.activations = activations;
    }
    /* ── Config ──────────────────────────────────────────────────────── */
    /**
     * 지금 적용 중인 설정 — 본문(config)까지 준다. 새 초안은 대개 지금 설정을 고쳐 만든다.
     * 본문을 볼 수 없으면 콘솔에서 초안을 만들 방법이 없어 API 를 직접 불러야 했다. (D-59)
     */
    async activeConfig(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        const active = await this.configs.active(cycleId);
        if (!active)
            throw problem_exception_1.ProblemException.notFound('활성화된 설정이 없습니다.');
        return { ...active, config: await this.configs.contentOf(active.id) };
    }
    /** 승인 대기함. 본문 없이 상태·승인자만. */
    async listConfigs(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        return { versions: await this.configs.list(cycleId) };
    }
    async createConfig(body, req) {
        return this.configs.createDraft({
            cycleId: this.required(body.cycleId, 'cycleId'),
            version: this.required(body.version, 'version'),
            config: body.config ?? {},
            createdBy: this.admin(req),
        });
    }
    /**
     * 승인 전에 무엇이 바뀌는지 본다. (§A14)
     * 이 응답의 `digest` 를 그대로 승인 요청에 실어 보낸다.
     */
    async configDiff(configId) {
        return this.configs.diff(configId);
    }
    /**
     * 승인. 본 Diff 의 digest 를 함께 받는다.
     * 승인자가 무엇이 바뀌는지 보지 못하면 두 명이 승인해도 사고를 막지 못한다.
     */
    async approveConfig(configId, body, req) {
        const row = await this.configs.approve(configId, this.admin(req), this.required(body?.acknowledgedDiffDigest, 'acknowledgedDiffDigest'));
        return {
            ...row,
            // 승인이 몇 명 남았는지 화면이 그대로 보여줄 수 있게 준다.
            remainingApprovals: Math.max(0, 2 - row.approvedBy.length),
        };
    }
    /**
     * 되돌리기. 전에 적용된 적이 있는 설정으로만 갈 수 있다.
     * 마감 임박 잠금은 여기 걸지 않는다 — 잘못된 설정으로 마감을 맞는 쪽이 더 큰 사고다.
     */
    async rollbackConfig(configId, body, req) {
        return this.configs.rollback({
            targetConfigId: configId,
            operator: this.admin(req),
            reason: body?.reason ?? '',
        });
    }
    async activateConfig(configId, body, req) {
        return this.configs.activate(configId, body?.activateAt ? new Date(body.activateAt) : null, this.admin(req));
    }
    /* ── Deadline Policy ─────────────────────────────────────────────── */
    async createPolicy(body, req) {
        const mode = this.required(body.mode, 'mode');
        return this.policies.createDraft({
            cycleId: this.required(body.cycleId, 'cycleId'),
            version: this.required(body.version, 'version'),
            mode,
            deadlineAt: this.required(body.deadlineAt, 'deadlineAt'),
            createdBy: this.admin(req),
        });
    }
    /**
     * 마감 연장 초안. (v1.1 §B17, T-M3-14)
     *
     * 지금 적용 중인 정책을 기준으로만 만들고, 사유와 **입학처 결정 문서번호**가 필수다.
     * 이 시스템은 연장을 결정하지 않는다. 입학처의 결정을 기록하고 집행한다.
     * 그 뒤는 일반 정책과 같다 — 작성자가 아닌 두 명이 승인해야 적용된다.
     */
    async createExtension(body, req) {
        return this.policies.createExtension({
            cycleId: this.required(body?.cycleId, 'cycleId'),
            deadlineAt: this.required(body?.deadlineAt, 'deadlineAt'),
            reason: body?.reason ?? '',
            decisionRef: body?.decisionRef ?? '',
            createdBy: this.admin(req),
        });
    }
    async approvePolicy(policyId, req) {
        const result = await this.policies.approve(policyId, this.admin(req));
        return { policyId, ...result, remainingApprovals: result.complete ? 0 : 1 };
    }
    /** ⚠️ 계약에 없는 경로. Config 와 대칭을 맞추기 위해 추가했다. (D-22) */
    async activatePolicy(policyId, body, req) {
        return this.policies.activate(policyId, body?.activateAt ? new Date(body.activateAt) : null, this.admin(req));
    }
    /** 마감정책 변경 이력. 분쟁 시 "누가 언제 바꿨는가"에 답한다. (§A2) */
    async policyHistory(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        return { policies: await this.policies.history(cycleId) };
    }
    /**
     * 서명된 활성화 이력 — 마감 정책·설정 전부. (T-M3-15)
     * 조회할 때마다 서명을 다시 검증한다. 분쟁 시 "누가 언제 왜 적용했는가" 에 답한다.
     */
    async activationHistory(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        const [records, systemChain] = await Promise.all([
            this.activations.list(cycleId),
            this.activations.verifySystemChain(),
        ]);
        return {
            activations: records,
            // 하나라도 검증에 실패하면 목록 전체를 믿을 수 없다. 화면이 맨 위에 띄운다.
            allSignaturesValid: records.every((r) => r.signature === 'VALID'),
            // 서명은 남은 기록이 진짜인지, 체인은 빠진 기록이 없는지를 말한다.
            systemChain,
        };
    }
    required(v, name) {
        if (!v)
            throw problem_exception_1.ProblemException.validationFailed(`${name} 가 필요합니다.`);
        return v;
    }
    /** 감사·2인 승인의 담당자. oidc 모드에서는 담당자 토큰의 신원, 그 밖의 모드에서는 기록용 헤더다 */
    admin(req) {
        return (0, identity_1.adminFrom)(req).adminId;
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('config/active'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "activeConfig", null);
__decorate([
    (0, common_1.Get)('config/versions'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "listConfigs", null);
__decorate([
    (0, common_1.Post)('config/versions'),
    (0, common_1.HttpCode)(201),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createConfig", null);
__decorate([
    (0, common_1.Get)('config/versions/:configId/diff'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('configId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "configDiff", null);
__decorate([
    (0, common_1.Post)('config/versions/:configId/approve'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('configId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "approveConfig", null);
__decorate([
    (0, common_1.Post)('config/versions/:configId/rollback'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('configId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "rollbackConfig", null);
__decorate([
    (0, common_1.Post)('config/versions/:configId/activate'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('configId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "activateConfig", null);
__decorate([
    (0, common_1.Post)('deadline-policies'),
    (0, common_1.HttpCode)(201),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createPolicy", null);
__decorate([
    (0, common_1.Post)('deadline-policies/extensions'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(201),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createExtension", null);
__decorate([
    (0, common_1.Post)('deadline-policies/:policyId/approve'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('policyId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "approvePolicy", null);
__decorate([
    (0, common_1.Post)('deadline-policies/:policyId/activate'),
    (0, admin_scope_1.StepUp)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('policyId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "activatePolicy", null);
__decorate([
    (0, common_1.Get)('deadline-policies'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "policyHistory", null);
__decorate([
    (0, common_1.Get)('activations'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "activationHistory", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, admin_scope_1.AdminScope)('admin'),
    (0, common_1.Controller)('admin/v1'),
    __metadata("design:paramtypes", [config_version_service_1.ConfigVersionService,
        deadline_policy_repository_1.DeadlinePolicyRepository,
        activation_recorder_1.ActivationRecorder])
], AdminController);
//# sourceMappingURL=admin.controller.js.map