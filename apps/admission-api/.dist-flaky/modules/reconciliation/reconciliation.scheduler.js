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
var ReconciliationScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconciliationScheduler = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const leader_lock_1 = require("../../common/scheduling/leader-lock");
const peak_mode_1 = require("../../common/scheduling/peak-mode");
const config_1 = require("../../config");
const reconciliation_service_1 = require("./reconciliation.service");
/**
 * 대조 자동 실행 — v1.1 §B18 "D+1 자동 대조" (D-40)
 *
 * 사람이 눌러야만 도는 대조는 사고가 난 뒤에야 돈다. 매 intervalMs 마다 최근
 * sinceHours 를 본다. 기본(1시간 · 48시간 창)이면 D+1 을 매시간 덮는다.
 *
 * Pod 가 여럿이어도 한 번만 돈다 (advisory lock). 같은 불일치를 두 Pod 가 동시에
 * 열면 예외 큐가 중복으로 찬다 — `openIfNew` 가 막지만 경합에 기대지 않는다.
 */
let ReconciliationScheduler = class ReconciliationScheduler {
    static { ReconciliationScheduler_1 = this; }
    db;
    reconciliation;
    peakMode;
    static LOCK = 'reconciliation:scheduled';
    logger = new common_1.Logger('reconciliation-schedule');
    timer = null;
    constructor(db, reconciliation, peakMode = config_1.PEAK_MODE) {
        this.db = db;
        this.reconciliation = reconciliation;
        this.peakMode = peakMode;
    }
    onModuleInit() {
        if (!config_1.RECON_SCHEDULE.autostart)
            return;
        this.timer = setInterval(() => void this.safeTick(), config_1.RECON_SCHEDULE.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async safeTick() {
        try {
            await this.tick();
        }
        catch (err) {
            this.logger.warn(`scheduled reconcile failed (${(0, server_kit_1.describeFailure)(err)})`);
        }
    }
    /** Peak Mode로 억제됐거나 다른 Pod가 돌고 있으면 null. */
    async tick(sinceHours = config_1.RECON_SCHEDULE.sinceHours) {
        if ((0, peak_mode_1.shouldSuspendNonCriticalJobs)(this.peakMode))
            return null;
        return (0, leader_lock_1.withLeaderLock)(this.db, ReconciliationScheduler_1.LOCK, () => this.reconciliation.reconcile(sinceHours));
    }
};
exports.ReconciliationScheduler = ReconciliationScheduler;
exports.ReconciliationScheduler = ReconciliationScheduler = ReconciliationScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(peak_mode_1.PEAK_MODE_POLICY)),
    __metadata("design:paramtypes", [server_kit_1.Db,
        reconciliation_service_1.ReconciliationService, Object])
], ReconciliationScheduler);
//# sourceMappingURL=reconciliation.scheduler.js.map