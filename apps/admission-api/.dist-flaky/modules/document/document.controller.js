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
exports.DocumentController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const identity_1 = require("../../common/identity/identity");
const ownership_service_1 = require("../../common/identity/ownership.service");
const problem_exception_1 = require("../../common/problem/problem.exception");
const document_service_1 = require("./document.service");
/**
 * 서류 API — canonical: k-admission-openapi.yaml
 *   createUploadIntent / completeUpload / deleteDocument
 *
 * 파일 자체는 이 서버를 지나가지 않는다. 브라우저가 Object Storage 로 직접 올린다.
 */
let DocumentController = class DocumentController {
    documents;
    ownership;
    constructor(documents, ownership) {
        this.documents = documents;
        this.ownership = ownership;
    }
    async createIntent(applicationId, body, req) {
        const documentType = this.required(body.documentType, 'documentType');
        const filename = this.required(body.filename, 'filename');
        const mediaType = this.required(body.mediaType, 'mediaType');
        if (typeof body.sizeBytes !== 'number') {
            throw problem_exception_1.ProblemException.validationFailed('파일 크기 정보가 없습니다. 파일을 다시 선택해 주십시오.');
        }
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertApplication(applicationId, applicantId);
        return this.documents.createIntent({
            applicationId,
            applicantId,
            documentType,
            filename,
            mediaType,
            sizeBytes: body.sizeBytes,
            ...this.context(req),
        });
    }
    async complete(documentId, body, req) {
        const sha256 = this.required(body.sha256, 'sha256');
        if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
            throw problem_exception_1.ProblemException.validationFailed('파일 확인 정보가 올바르지 않습니다. 파일을 다시 올려 주십시오.');
        }
        if (typeof body.sizeBytes !== 'number') {
            throw problem_exception_1.ProblemException.validationFailed('파일 크기 정보가 없습니다. 파일을 다시 선택해 주십시오.');
        }
        // 업로드 완료 보고도 소유자만 할 수 있다. 남의 서류 상태를 바꿀 수 있으면
        // 검사 대기 중인 서류를 임의로 확정시킬 수 있다.
        await this.ownership.assertDocument(documentId, (0, identity_1.applicantFrom)(req).applicantId);
        const doc = await this.documents.complete({
            documentId,
            sha256,
            sizeBytes: body.sizeBytes,
            ...this.context(req),
        });
        return {
            id: doc.id,
            status: doc.status,
            filename: doc.filename,
            mediaType: doc.mediaType,
            sizeBytes: doc.sizeBytes,
        };
    }
    async remove(documentId, req) {
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertDocument(documentId, applicantId);
        await this.documents.remove(documentId, applicantId);
    }
    required(value, name) {
        if (!value)
            throw problem_exception_1.ProblemException.validationFailed(`${name} 가 필요합니다.`);
        return value;
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
exports.DocumentController = DocumentController;
__decorate([
    (0, common_1.Post)('applications/:applicationId/documents/upload-intents'),
    (0, common_1.HttpCode)(201),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], DocumentController.prototype, "createIntent", null);
__decorate([
    (0, common_1.Post)('documents/:documentId/complete'),
    (0, common_1.HttpCode)(202),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('documentId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], DocumentController.prototype, "complete", null);
__decorate([
    (0, common_1.Delete)('documents/:documentId'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('documentId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DocumentController.prototype, "remove", null);
exports.DocumentController = DocumentController = __decorate([
    (0, common_1.Controller)('api/v1'),
    __metadata("design:paramtypes", [document_service_1.DocumentService,
        ownership_service_1.Ownership])
], DocumentController);
//# sourceMappingURL=document.controller.js.map