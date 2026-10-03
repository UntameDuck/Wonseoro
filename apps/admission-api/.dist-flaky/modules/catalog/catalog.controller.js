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
exports.CatalogController = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
/**
 * 모집 카탈로그 — canonical: k-admission-openapi.yaml
 *   getCurrentCycle / listAdmissionTypes / listDepartments
 *
 * 조회성 트래픽이라 중앙에서 Cache 해도 되는 대상이지만 (v1.1 §10 §10),
 * **원본은 대학이 제공한다.** 중앙 검색이 죽어도 대학 직접 URL 로 접수할 수 있어야 하므로
 * 이 경로는 대학 Data Plane 에 있다. (v1.1 §10 §1)
 */
let CatalogController = class CatalogController {
    db;
    constructor(db) {
        this.db = db;
    }
    async currentCycle() {
        const { rows } = await this.db.query(`SELECT c.id, c.admission_year, c.name, c.opens_at, c.closes_at, c.status, c.university_id,
              u.name AS university_name
         FROM admission_cycle c
         JOIN university u ON u.id = c.university_id
        WHERE c.status = 'OPEN'
        ORDER BY c.opens_at DESC
        LIMIT 1`);
        const r = rows[0];
        // 진행 중인 모집이 없는 것은 입력 오류가 아니다 — 계약대로 404.
        if (!r)
            throw problem_exception_1.ProblemException.notFound('진행 중인 모집이 없습니다.');
        return {
            id: String(r.id),
            universityId: String(r.university_id),
            // 화면에 대학 식별자(UNIV-A)가 아니라 이름을 보인다
            universityName: String(r.university_name),
            admissionYear: Number(r.admission_year),
            name: String(r.name),
            opensAt: r.opens_at.toISOString(),
            closesAt: r.closes_at.toISOString(),
            status: String(r.status),
        };
    }
    async admissionTypes(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        const { rows } = await this.db.query(`SELECT id, code, name, fee_amount
         FROM admission_type
        WHERE cycle_id = $1 AND active = true
        ORDER BY code`, [cycleId]);
        return rows.map((r) => ({
            id: String(r.id),
            code: String(r.code),
            name: String(r.name),
            // 전형료의 최종 기준은 대학 설정이다. 클라이언트가 계산하지 않는다. (v1.1 §10 §1)
            feeAmount: Number(r.fee_amount),
        }));
    }
    async departments(cycleId) {
        if (!cycleId)
            throw problem_exception_1.ProblemException.validationFailed('모집을 지정해 주십시오.');
        const { rows } = await this.db.query(`SELECT id, code, name, quota
         FROM department
        WHERE cycle_id = $1 AND active = true
        ORDER BY code`, [cycleId]);
        return rows.map((r) => ({
            id: String(r.id),
            code: String(r.code),
            name: String(r.name),
            quota: r.quota === null ? null : Number(r.quota),
        }));
    }
};
exports.CatalogController = CatalogController;
__decorate([
    (0, common_1.Get)('admission-cycles/current'),
    (0, common_1.Header)('cache-control', 'public, max-age=60'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "currentCycle", null);
__decorate([
    (0, common_1.Get)('admission-types'),
    (0, common_1.Header)('cache-control', 'public, max-age=60'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "admissionTypes", null);
__decorate([
    (0, common_1.Get)('departments'),
    (0, common_1.Header)('cache-control', 'public, max-age=60'),
    __param(0, (0, common_1.Query)('cycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "departments", null);
exports.CatalogController = CatalogController = __decorate([
    (0, common_1.Controller)('api/v1'),
    __metadata("design:paramtypes", [server_kit_1.Db])
], CatalogController);
//# sourceMappingURL=catalog.controller.js.map