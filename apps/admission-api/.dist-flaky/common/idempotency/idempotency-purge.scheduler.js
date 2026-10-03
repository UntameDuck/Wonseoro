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
var IdempotencyPurgeScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyPurgeScheduler = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const leader_lock_1 = require("../scheduling/leader-lock");
const peak_mode_1 = require("../scheduling/peak-mode");
const config_1 = require("../../config");
const idempotency_store_1 = require("./idempotency.store");
/**
 * 만료된 멱등 기록 정리 (D-11).
 *
 * 기록은 24시간 뒤 만료되지만 지우는 쪽이 없었다(`purgeExpired` 가 어디서도 불리지 않았다).
 * 마감 피크의 모든 변경 요청이 한 행씩 남아 표가 끝없이 자란다.
 *
 * 대조 스케줄러와 같은 규칙이다 — Pod 가 여럿이어도 한 곳만 돈다(세션 advisory lock),
 * Peak Mode 억제 구간에는 쉰다. 한 번에 정해진 건수씩 지우고, 남았으면 다음 주기에 이어서 지운다.
 */
let IdempotencyPurgeScheduler = class IdempotencyPurgeScheduler {
    static { IdempotencyPurgeScheduler_1 = this; }
    db;
    store;
    peakMode;
    static LOCK = 'idempotency:purge';
    logger = new common_1.Logger('idempotency-purge');
    timer = null;
    constructor(db, store, peakMode = config_1.PEAK_MODE) {
        this.db = db;
        this.store = store;
        this.peakMode = peakMode;
    }
    onModuleInit() {
        if (!config_1.IDEMPOTENCY_PURGE.autostart)
            return;
        this.timer = setInterval(() => void this.safeTick(), config_1.IDEMPOTENCY_PURGE.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async safeTick() {
        try {
            const purged = await this.tick();
            if (purged)
                this.logger.log(`만료된 멱등 기록 ${purged}건을 지웠다`);
        }
        catch (err) {
            this.logger.warn(`idempotency purge failed (${(0, server_kit_1.describeFailure)(err)})`);
        }
    }
    /** Peak Mode 로 억제됐거나 다른 Pod 가 돌고 있으면 null. */
    async tick() {
        if ((0, peak_mode_1.shouldSuspendNonCriticalJobs)(this.peakMode))
            return null;
        return (0, leader_lock_1.withLeaderLock)(this.db, IdempotencyPurgeScheduler_1.LOCK, () => this.store.purgeExpired());
    }
};
exports.IdempotencyPurgeScheduler = IdempotencyPurgeScheduler;
exports.IdempotencyPurgeScheduler = IdempotencyPurgeScheduler = IdempotencyPurgeScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(peak_mode_1.PEAK_MODE_POLICY)),
    __metadata("design:paramtypes", [server_kit_1.Db,
        idempotency_store_1.IdempotencyStore, Object])
], IdempotencyPurgeScheduler);
//# sourceMappingURL=idempotency-purge.scheduler.js.map