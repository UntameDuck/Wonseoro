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
exports.BusinessGauges = void 0;
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const server_kit_1 = require("@wonseoro/server-kit");
const REFRESH_MS = 15_000;
let BusinessGauges = class BusinessGauges {
    db;
    logger = new common_1.Logger('business-gauges');
    timer = null;
    snapshot = null;
    failing = false;
    constructor(db) {
        this.db = db;
        const meter = api_1.metrics.getMeter('k-admission.business');
        const gauge = (name, description, unit, pick) => {
            meter
                .createObservableGauge(name, { description, unit })
                .addCallback((result) => {
                if (this.snapshot)
                    result.observe(pick(this.snapshot));
            });
        };
        gauge('outbox_backlog', '전송 대기 Outbox 이벤트 수', '{event}', (s) => s.outboxBacklog);
        gauge('outbox_oldest_age_seconds', '가장 오래 기다린 전송 대기 이벤트의 나이', 's', (s) => s.outboxOldestAgeSeconds);
        gauge('outbox_dead_events', '재시도를 멈춘 Outbox 이벤트 수', '{event}', (s) => s.outboxDeadEvents);
        gauge('central_sync_lag_seconds', '중앙이 아직 모르는 가장 오래된 이벤트의 나이', 's', (s) => s.centralSyncLagSeconds);
        gauge('document_scan_pending', '검사 대기 서류 수', '{document}', (s) => s.documentScanPending);
        gauge('db_lock_waiting_sessions', '행 잠금을 기다리는 앱 세션 수', '{session}', (s) => s.dbLockWaitingSessions);
    }
    onModuleInit() {
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    /** 시험에서 직접 부른다. */
    async refresh() {
        try {
            this.snapshot = await this.read();
            if (this.failing)
                this.logger.log('KPI 게이지 읽기 복구');
            this.failing = false;
        }
        catch (error) {
            this.snapshot = null;
            if (!this.failing)
                this.logger.warn(`KPI 게이지를 읽지 못했다: ${(0, server_kit_1.describeFailure)(error)}`);
            this.failing = true;
        }
        return this.snapshot;
    }
    async read() {
        const { rows } = await this.db.query(`SELECT
         (SELECT count(*) FROM outbox_event WHERE status IN ('PENDING','SENDING')) AS backlog,
         (SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
            FROM outbox_event WHERE status IN ('PENDING','SENDING')) AS oldest,
         (SELECT count(*) FROM outbox_event WHERE status = 'DEAD') AS dead,
         (SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
            FROM outbox_event WHERE status <> 'SENT') AS lag,
         (SELECT count(*) FROM document WHERE status = 'QUARANTINED') AS scan_pending,
         (SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock') AS lock_waiting`);
        const r = rows[0] ?? {};
        return {
            outboxBacklog: Number(r.backlog ?? 0),
            outboxOldestAgeSeconds: Math.floor(Number(r.oldest ?? 0)),
            outboxDeadEvents: Number(r.dead ?? 0),
            centralSyncLagSeconds: Math.floor(Number(r.lag ?? 0)),
            documentScanPending: Number(r.scan_pending ?? 0),
            dbLockWaitingSessions: Number(r.lock_waiting ?? 0),
        };
    }
};
exports.BusinessGauges = BusinessGauges;
exports.BusinessGauges = BusinessGauges = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db])
], BusinessGauges);
//# sourceMappingURL=business-gauges.js.map