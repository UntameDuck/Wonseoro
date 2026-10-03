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
var OutboxArchiveScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxArchiveModule = exports.OutboxArchiveScheduler = void 0;
exports.archiveOutbox = archiveOutbox;
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const leader_lock_1 = require("../scheduling/leader-lock");
const peak_mode_1 = require("../scheduling/peak-mode");
const archived = api_1.metrics.getMeter('k-admission.outbox').createCounter('outbox_archived', {
    description: '보관 표로 옮긴 Outbox 이벤트 수 (T-M4-10)',
});
const dropped = api_1.metrics.getMeter('k-admission.outbox').createCounter('outbox_archive_partitions_dropped', {
    description: '보관 기간이 지나 지운 보관 파티션 수',
});
/**
 * 전송·확인이 끝나고 `afterDays` 가 지난 이벤트를 영수증과 함께 보관 표(월별 파티션, 0005)로 옮긴다.
 *   - 원서마다 가장 큰 순번은 남긴다 — 다음 순번이 MAX()+1 이라 순번이 이어진다
 *   - DEAD·미전송은 옮기지 않는다(사람이 봐야 하고, 아직 보내야 한다)
 *   - 한 번에 `batch` 건, 한 트랜잭션 — 옮기다 실패하면 아무것도 바뀌지 않는다
 * 장기 장애 중에 쌓이는 미전송 이벤트는 여기 대상이 아니다 — 그쪽은 Relay 의 오프라인 한도(offlineSpool)가 본다.
 */
async function archiveOutbox(db, o) {
    const oldest = await db.query(`SELECT min(created_at) AS t FROM outbox_event WHERE status = 'SENT' AND sent_at < now() - make_interval(days => $1)`, [o.afterDays]);
    const parts = await db.query(`SELECT * FROM outbox_archive_partitions($1, 3, $2)`, [
        oldest.rows[0]?.t ?? null,
        o.keepMonths,
    ]);
    const moved = await db.tx((c) => moveBatch(c, o.afterDays, o.batch));
    archived.add(moved);
    const result = { moved, partitionsCreated: parts.rows[0]?.created ?? [], partitionsDropped: parts.rows[0]?.dropped ?? [] };
    dropped.add(result.partitionsDropped.length);
    return result;
}
async function moveBatch(c, afterDays, batch) {
    const { rows } = await c.query(`WITH pick AS (
       SELECT o.id FROM outbox_event o
         JOIN sync_receipt r ON r.outbox_event_id = o.id
        WHERE o.status = 'SENT' AND o.sent_at < now() - make_interval(days => $1)
          AND EXISTS (SELECT 1 FROM outbox_event n WHERE n.aggregate_id = o.aggregate_id AND n.aggregate_sequence > o.aggregate_sequence)
        ORDER BY o.created_at
        LIMIT $2
        FOR UPDATE OF o SKIP LOCKED
     ), moved AS (
       INSERT INTO outbox_event_archive
         (id, aggregate_type, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash, status,
          created_at, sent_at, central_receipt_id, acknowledged_at, central_sequence, receipt_hash)
       SELECT o.id, o.aggregate_type, o.aggregate_id, o.aggregate_sequence, o.event_type, o.schema_version, o.payload, o.payload_hash, o.status,
              o.created_at, o.sent_at, r.central_receipt_id, r.acknowledged_at, r.central_sequence, r.receipt_hash
         FROM outbox_event o JOIN sync_receipt r ON r.outbox_event_id = o.id
        WHERE o.id IN (SELECT id FROM pick)
       RETURNING id
     ), receipts AS (
       DELETE FROM sync_receipt WHERE outbox_event_id IN (SELECT id FROM moved) RETURNING outbox_event_id
     )
     DELETE FROM outbox_event WHERE id IN (SELECT outbox_event_id FROM receipts) RETURNING id`, [afterDays, batch]);
    return rows.length;
}
/** 매시간·리더 하나·Peak Mode 억제 구간에는 쉰다 — 멱등 기록 정리와 같은 규칙 */
let OutboxArchiveScheduler = class OutboxArchiveScheduler {
    static { OutboxArchiveScheduler_1 = this; }
    db;
    peakMode;
    static LOCK = 'outbox:archive';
    logger = new common_1.Logger('outbox-archive');
    timer = null;
    constructor(db, peakMode = config_1.PEAK_MODE) {
        this.db = db;
        this.peakMode = peakMode;
    }
    onModuleInit() {
        if (!config_1.OUTBOX_ARCHIVE.autostart)
            return;
        this.timer = setInterval(() => void this.safeTick(), config_1.OUTBOX_ARCHIVE.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async safeTick() {
        try {
            const r = await this.tick();
            if (r && (r.moved || r.partitionsDropped.length)) {
                this.logger.log(`Outbox ${r.moved}건 보관, 지운 파티션 ${r.partitionsDropped.join(',') || '없음'}`);
            }
        }
        catch (err) {
            this.logger.warn(`outbox archive failed (${(0, server_kit_1.describeFailure)(err)})`);
        }
    }
    async tick() {
        if ((0, peak_mode_1.shouldSuspendNonCriticalJobs)(this.peakMode))
            return null;
        return (0, leader_lock_1.withLeaderLock)(this.db, OutboxArchiveScheduler_1.LOCK, () => archiveOutbox(this.db, config_1.OUTBOX_ARCHIVE));
    }
};
exports.OutboxArchiveScheduler = OutboxArchiveScheduler;
exports.OutboxArchiveScheduler = OutboxArchiveScheduler = OutboxArchiveScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(peak_mode_1.PEAK_MODE_POLICY)),
    __metadata("design:paramtypes", [server_kit_1.Db, Object])
], OutboxArchiveScheduler);
let OutboxArchiveModule = class OutboxArchiveModule {
};
exports.OutboxArchiveModule = OutboxArchiveModule;
exports.OutboxArchiveModule = OutboxArchiveModule = __decorate([
    (0, common_1.Module)({
        providers: [{ provide: peak_mode_1.PEAK_MODE_POLICY, useValue: config_1.PEAK_MODE }, OutboxArchiveScheduler],
    })
], OutboxArchiveModule);
//# sourceMappingURL=outbox-archive.js.map