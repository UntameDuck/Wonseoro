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
exports.FinalizationController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const identity_1 = require("../../common/identity/identity");
const ownership_service_1 = require("../../common/identity/ownership.service");
const problem_exception_1 = require("../../common/problem/problem.exception");
const server_clock_1 = require("../../common/time/server-clock");
const finalization_service_1 = require("./finalization.service");
/**
 * 최종 접수 — canonical: k-admission-openapi.yaml
 *   finalizeApplication / getApplicationSubmission / getReceipt
 *
 * 재시도는 200, 신규 접수는 201. OpenAPI 가 둘을 구분한다.
 */
let FinalizationController = class FinalizationController {
    finalization;
    ownership;
    constructor(finalization, ownership) {
        this.finalization = finalization;
        this.ownership = ownership;
    }
    async finalize(applicationId, req, reply) {
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertApplication(applicationId, applicantId);
        const { submission, created } = await this.finalization.finalize({
            applicationId,
            applicantId,
            // 요청이 서버에 도달한 시각. 마감 정책이 이 값을 쓸 수 있다. (v1.1 §A2)
            // DB 시계에 맞춘 값이다 — Pod 마다 다른 시계로 요청 수신 시각을 찍지 않는다.
            requestedAt: (0, server_clock_1.serverNow)(),
            ...this.context(req),
        });
        reply.status(created ? 201 : 200);
        return this.present(submission);
    }
    async get(applicationId, req) {
        await this.ownership.assertApplication(applicationId, (0, identity_1.applicantFrom)(req).applicantId);
        const submission = await this.finalization.findSubmission(applicationId);
        if (!submission) {
            // 계약은 404 다. 원서는 본인 것이지만 접수 기록이 아직 없다.
            throw problem_exception_1.ProblemException.notFound('아직 접수되지 않은 원서입니다.');
        }
        return this.present(submission);
    }
    /**
     * 접수증. 발급할 때마다 감사에 남긴다(RECEIPT_ISSUED) — "접수증을 받았다" 는 지원자가
     * 접수 완료를 확인한 증거다. 접수증 화면은 지원자 웹의 인쇄용 페이지가 그린다.
     */
    async receipt(submissionId, req) {
        // 접수증에는 접수번호가 있다. 남의 접수번호를 알 수 있으면 안 된다.
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertSubmission(submissionId, applicantId);
        const submission = await this.finalization.issueReceipt(submissionId, applicantId, this.context(req));
        if (!submission) {
            throw problem_exception_1.ProblemException.notFound('존재하지 않는 접수입니다.');
        }
        const names = await this.finalization.receiptNames(submission.applicationId);
        return {
            submissionId: submission.submissionId,
            applicationNumber: submission.applicationNumber,
            finalizedAt: submission.finalizedAt,
            // 접수증 항목 — 전형·모집단위·상태 (계약 1.6.0)
            admissionTypeName: names.admissionTypeName,
            departmentName: names.departmentName,
            status: 'FINALIZED',
        };
    }
    present(s) {
        return {
            applicationId: s.applicationId,
            submissionId: s.submissionId,
            applicationNumber: s.applicationNumber,
            status: 'FINALIZED',
            requestedAt: s.requestedAt,
            paymentVerifiedAt: s.paymentVerifiedAt,
            finalizedAt: s.finalizedAt,
            deadlinePolicyVersion: s.deadlinePolicyVersion,
            configVersion: s.configVersion,
            serverTime: (0, server_clock_1.serverNow)().toISOString(),
        };
    }
    context(req) {
        const tp = req.headers.traceparent;
        const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
        return {
            ...(traceId ? { traceId } : {}),
            ...(req.ip ? { sourceIp: req.ip } : {}),
        };
    }
};
exports.FinalizationController = FinalizationController;
__decorate([
    (0, common_1.Post)('applications/:applicationId/finalize'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FinalizationController.prototype, "finalize", null);
__decorate([
    (0, common_1.Get)('applications/:applicationId/submission'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FinalizationController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('submissions/:submissionId/receipt'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('submissionId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FinalizationController.prototype, "receipt", null);
exports.FinalizationController = FinalizationController = __decorate([
    (0, common_1.Controller)('api/v1'),
    __metadata("design:paramtypes", [finalization_service_1.FinalizationService,
        ownership_service_1.Ownership])
], FinalizationController);
//# sourceMappingURL=finalization.controller.js.map