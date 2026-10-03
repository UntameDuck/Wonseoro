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
exports.FormSchemaController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const identity_1 = require("../../common/identity/identity");
const ownership_service_1 = require("../../common/identity/ownership.service");
const problem_exception_1 = require("../../common/problem/problem.exception");
const form_schema_service_1 = require("./form-schema.service");
/**
 * 추가문항 스키마 조회 — 기술설계서 v1.1 §A5
 *
 * 계약: OpenAPI getApplicationFormSchema (D-19). profileFields·documents 는 v1.4.0 에서 더했다 (D-56).
 *
 * **이 API 가 없으면 §A5 가 UI 에서 깨진다.**
 * 백엔드는 Config 만 바꿔 새 전형을 받을 수 있는데, 화면이 필드를 하드코딩하면
 * 전형이 늘 때마다 프론트를 고쳐야 한다. 그러면 "code fork 0" 이 아니다.
 *
 * 원서 단위로 준다. 스키마는 전형 × 활성 Config 버전의 조합이고,
 * 원서는 이미 둘 다 알고 있으므로 클라이언트가 조합을 계산할 필요가 없다.
 */
let FormSchemaController = class FormSchemaController {
    db;
    forms;
    ownership;
    constructor(db, forms, ownership) {
        this.db = db;
        this.forms = forms;
        this.ownership = ownership;
    }
    async get(applicationId, req) {
        // 스키마 자체는 비밀이 아니지만, 원서 단위로 주는 API 다.
        // 남의 원서 식별자로 그 사람이 어느 전형에 지원했는지 알 수 있으면 안 된다.
        await this.ownership.assertApplication(applicationId, (0, identity_1.applicantFrom)(req).applicantId);
        const { rows } = await this.db.query(`SELECT a.cycle_id, t.code
         FROM application a
         JOIN admission_type t ON t.id = a.admission_type_id
        WHERE a.id = $1`, [applicationId]);
        const found = rows[0];
        if (!found)
            throw problem_exception_1.ProblemException.validationFailed('존재하지 않는 원서입니다.');
        const { schemaVersion, schema, profileFields, documents } = await this.forms.load(found.cycle_id, found.code);
        // 화면은 이것만 보고 그린다 — 입력 항목(schema), 공통원서에서 온 항목(profileFields),
        // 올릴 서류(documents). 전형이 늘어도 프론트를 고치지 않는다. (§A5)
        return {
            admissionTypeCode: found.code,
            schemaVersion,
            schema,
            profileFields,
            documents,
        };
    }
};
exports.FormSchemaController = FormSchemaController;
__decorate([
    (0, common_1.Get)(':applicationId/form-schema'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FormSchemaController.prototype, "get", null);
exports.FormSchemaController = FormSchemaController = __decorate([
    (0, common_1.Controller)('api/v1/applications'),
    __metadata("design:paramtypes", [server_kit_1.Db,
        form_schema_service_1.FormSchemaService,
        ownership_service_1.Ownership])
], FormSchemaController);
//# sourceMappingURL=form-schema.controller.js.map