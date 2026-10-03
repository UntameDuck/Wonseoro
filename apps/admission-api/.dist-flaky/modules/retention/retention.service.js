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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionService = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const DAY_MS = 86_400_000;
/**
 * 파기 계획 — v1.1 §A15 (T-M3-10)
 *
 * **계획만 보여준다. 지우지 않는다.**
 * 파기는 되돌릴 수 없다. 지우는 코드는 WORM 이관(M5)과 함께, 그리고 이 계획을
 * 사람이 읽고 승인하는 절차와 함께 붙인다. 계획 없이 지우는 코드부터 만들면
 * 보존정책의 오타 하나가 한 해 입시 기록을 지운다.
 *
 * 원서 "파기" 는 행 삭제가 아니라 **내용 제거**다. 감사 체인이 원서 행을 참조하고
 * (audit_event.application_id, CASCADE 없음), 원서를 지우면 동의 기록이 함께
 * 지워진다(consent_record ON DELETE CASCADE). 행을 지우는 순간 증적이 깨진다. (D-38)
 */
let RetentionService = class RetentionService {
    db;
    constructor(db) {
        this.db = db;
    }
    async plan(cycleId) {
        const { rows: cyc } = await this.db.query(`SELECT closes_at FROM admission_cycle WHERE id = $1`, [cycleId]);
        if (!cyc[0])
            throw problem_exception_1.ProblemException.validationFailed('존재하지 않는 모집입니다.');
        const closesAt = cyc[0].closes_at;
        const { rows: cfg } = await this.db.query(`SELECT version, config_json FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`, [cycleId]);
        const policy = cfg[0]?.config_json?.retention;
        const now = Date.now();
        const items = [];
        for (const code of Object.keys(contracts_1.RETENTION_CATEGORIES)) {
            const cat = contracts_1.RETENTION_CATEGORIES[code];
            const base = { code, label: cat.label, floor: cat.floor, purge: cat.purge };
            if (cat.floor.kind === 'IMMUTABLE') {
                items.push({ ...base, days: null, dueAt: null, status: 'IMMUTABLE', affected: null });
                continue;
            }
            const days = policy?.[code]?.days;
            if (typeof days !== 'number') {
                items.push({ ...base, days: null, dueAt: null, status: 'UNSET', affected: null });
                continue;
            }
            if (cat.anchor === 'EVENT_TIME') {
                // 사건 단위. "기간이 지난 기록이 몇 건인가" 를 센다.
                const before = new Date(now - days * DAY_MS);
                const affected = await this.countEvents(code, before);
                items.push({
                    ...base,
                    days,
                    dueAt: null,
                    status: affected > 0 ? (cat.purge === 'NONE' ? 'DUE_BUT_CHAINED' : 'DUE') : 'RETAINED',
                    affected: affected > 0 ? affected : null,
                });
                continue;
            }
            const dueAt = new Date(closesAt.getTime() + days * DAY_MS);
            const due = now >= dueAt.getTime();
            items.push({
                ...base,
                days,
                dueAt: dueAt.toISOString(),
                status: due ? 'DUE' : 'RETAINED',
                affected: due ? await this.countInCycle(code, cycleId) : null,
            });
        }
        return {
            cycleId,
            cycleClosesAt: closesAt.toISOString(),
            configVersion: cfg[0]?.version ?? null,
            configured: policy !== undefined,
            problems: policy === undefined ? [] : (0, contracts_1.validateRetention)(policy),
            items,
            executes: false,
            generatedAt: new Date(now).toISOString(),
        };
    }
    async countInCycle(code, cycleId) {
        const sql = {
            APPLICATION_UNSUBMITTED: `SELECT count(*) AS n FROM application
                                 WHERE cycle_id = $1 AND status <> 'FINALIZED'`,
            APPLICATION_SUBMITTED: `SELECT count(*) AS n FROM application
                               WHERE cycle_id = $1 AND status = 'FINALIZED'`,
            // 다른 모집에도 원서가 있는 지원자의 신원은 이 모집 때문에 지울 수 없다.
            APPLICANT_PII: `SELECT count(DISTINCT a.applicant_id) AS n FROM application a
                       WHERE a.cycle_id = $1
                         AND NOT EXISTS (SELECT 1 FROM application o
                                          WHERE o.applicant_id = a.applicant_id
                                            AND o.cycle_id <> $1)`,
            DOCUMENT_FILE: `SELECT count(*) AS n FROM document d JOIN application a ON a.id = d.application_id
                       WHERE a.cycle_id = $1 AND d.status <> 'DELETED'`,
            PAYMENT_RECORD: `SELECT count(*) AS n FROM payment p JOIN application a ON a.id = p.application_id
                        WHERE a.cycle_id = $1`,
            CONSENT_RECORD: `SELECT count(*) AS n FROM consent_record c JOIN application a ON a.id = c.application_id
                        WHERE a.cycle_id = $1`,
        };
        const q = sql[code];
        if (!q)
            return 0;
        const { rows } = await this.db.query(q, [cycleId]);
        return Number(rows[0]?.n ?? 0);
    }
    async countEvents(code, before) {
        if (code !== 'ADMIN_ACCESS_LOG')
            return 0;
        const { rows } = await this.db.query(`SELECT count(*) AS n FROM audit_event
        WHERE action = 'ADMIN_VIEWED_PII' AND occurred_at < $1`, [before]);
        return Number(rows[0]?.n ?? 0);
    }
};
exports.RetentionService = RetentionService;
exports.RetentionService = RetentionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db])
], RetentionService);
//# sourceMappingURL=retention.service.js.map