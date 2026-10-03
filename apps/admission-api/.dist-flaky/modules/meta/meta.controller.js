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
exports.MetaController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const deadline_service_1 = require("../deadline/deadline.service");
/**
 * GET /api/v1/meta/time
 * canonical: k-admission-openapi.yaml — operationId getServerTime,
 *            응답 스키마 #/components/schemas/ServerTime
 *
 * 클라이언트는 자기 시계로 마감을 계산하지 않는다. (v1.1 §A2)
 * 남은 시간 표시·경고·제출 가능 여부 판단의 기준을 모두 이 응답에서 가져간다.
 */
let MetaController = class MetaController {
    deadline;
    db;
    constructor(deadline, db) {
        this.deadline = deadline;
        this.db = db;
    }
    async time(admissionCycleId) {
        let cycleId = admissionCycleId;
        if (!cycleId) {
            const { rows } = await this.db.query(`SELECT id FROM admission_cycle
          WHERE status = 'OPEN'
          ORDER BY opens_at DESC
          LIMIT 1`);
            cycleId = rows[0]?.id;
        }
        if (!cycleId)
            throw problem_exception_1.ProblemException.notFound('진행 중인 모집이 없습니다.');
        return this.deadline.snapshot(cycleId);
    }
};
exports.MetaController = MetaController;
__decorate([
    (0, common_1.Get)('time'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Query)('admissionCycleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MetaController.prototype, "time", null);
exports.MetaController = MetaController = __decorate([
    (0, common_1.Controller)('api/v1/meta'),
    __metadata("design:paramtypes", [deadline_service_1.DeadlineService,
        server_kit_1.Db])
], MetaController);
//# sourceMappingURL=meta.controller.js.map