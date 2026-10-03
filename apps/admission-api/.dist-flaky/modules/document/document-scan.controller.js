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
exports.DocumentScanController = void 0;
exports.parseScanLimit = parseScanLimit;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const document_service_1 = require("./document.service");
const object_storage_1 = require("./object-storage");
function parseScanLimit(value) {
    if (value === undefined)
        return 50;
    if (!/^\d+$/.test(value)) {
        throw problem_exception_1.ProblemException.validationFailed('조회할 서류 수는 1 이상 200 이하의 정수여야 합니다.');
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw problem_exception_1.ProblemException.validationFailed('조회할 서류 수는 1 이상 200 이하의 정수여야 합니다.');
    }
    return Math.min(parsed, 200);
}
/**
 * AV 검사 워커용 내부 API — 기술설계서 v1.0 §5.4, ADR-0004
 *
 * 계약: OpenAPI listDocumentsPendingScan · reportDocumentScanResult (D-20).
 *
 * `document-service` 가 QUARANTINED 서류를 가져가 검사하고 결과를 돌려준다.
 * 운영에서는 mTLS 로만 접근하며 외부에 노출하지 않는다. (M5 T-M5-05)
 */
let DocumentScanController = class DocumentScanController {
    documents;
    db;
    storage;
    constructor(documents, db, storage) {
        this.documents = documents;
        this.db = db;
        this.storage = storage;
    }
    /** 검사 대기 목록. 워커가 폴링한다. */
    async pending(limit) {
        const max = parseScanLimit(limit);
        const { rows } = await this.db.query(`SELECT d.id, d.object_key, d.media_type, d.size_bytes, d.sha256_hex
         FROM document d
         JOIN document_scan s ON s.document_id = d.id AND s.result = 'PENDING'
        WHERE d.status = 'QUARANTINED'
        ORDER BY d.created_at
        LIMIT $1`, [max]);
        // 검사 엔진이 파일을 읽을 짧은 수명의 다운로드 URL 을 함께 준다. 워커에 Object Storage 자격증명을
        // 주지 않는다 — 워커는 이 URL 이 가리키는 파일 하나만, 몇 분 동안만 읽을 수 있다(최소권한, §06).
        const documents = [];
        for (const r of rows) {
            documents.push({
                documentId: String(r.id),
                objectKey: String(r.object_key),
                mediaType: String(r.media_type),
                sizeBytes: Number(r.size_bytes),
                sha256: String(r.sha256_hex),
                downloadUrl: await this.storage.presignDownload(String(r.object_key), String(r.id)),
            });
        }
        return { documents };
    }
    async scanResult(documentId, body) {
        const result = body.result;
        if (result !== 'CLEAN' && result !== 'MALICIOUS' && result !== 'ERROR') {
            throw problem_exception_1.ProblemException.validationFailed('result 는 CLEAN / MALICIOUS / ERROR 중 하나여야 합니다.');
        }
        const status = await this.documents.applyScanResult(documentId, result, typeof body.scanner === 'string' && body.scanner ? body.scanner : 'unknown', typeof body.engineVersion === 'string' && body.engineVersion ? body.engineVersion : null, typeof body.signature === 'string' && body.signature ? { signature: body.signature.slice(0, 200) } : {});
        return { documentId, result, status };
    }
};
exports.DocumentScanController = DocumentScanController;
__decorate([
    (0, common_1.Get)('pending-scan'),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentScanController.prototype, "pending", null);
__decorate([
    (0, common_1.Post)(':documentId/scan-result'),
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', 'no-store'),
    __param(0, (0, common_1.Param)('documentId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DocumentScanController.prototype, "scanResult", null);
exports.DocumentScanController = DocumentScanController = __decorate([
    (0, common_1.Controller)('internal/v1/documents'),
    __metadata("design:paramtypes", [document_service_1.DocumentService,
        server_kit_1.Db,
        object_storage_1.ObjectStorage])
], DocumentScanController);
//# sourceMappingURL=document-scan.controller.js.map