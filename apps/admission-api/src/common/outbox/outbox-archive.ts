import { Inject, Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { OUTBOX_ARCHIVE, PEAK_MODE, UNIVERSITY_ID } from '../../config';
import type { Queryable } from '../db/queryable';
import { withLeaderLock } from '../scheduling/leader-lock';
import { checkEveryMs, markSuspended, registerPeriodicJob, runIfDue, type PeriodicJob } from '../scheduling/periodic-job';
import { PEAK_MODE_POLICY, PeakModePolicy, shouldSuspendNonCriticalJobs } from '../scheduling/peak-mode';

const archived = metrics.getMeter('k-admission.outbox').createCounter('outbox_archived', {
  description: '보관 표로 옮긴 Outbox 이벤트 수 (T-M4-10)',
});
const dropped = metrics.getMeter('k-admission.outbox').createCounter('outbox_archive_partitions_dropped', {
  description: '보관 기간이 지나 지운 보관 파티션 수',
});

export interface ArchiveResult {
  moved: number;
  partitionsCreated: string[];
  partitionsDropped: string[];
}

/**
 * 전송·확인이 끝나고 `afterDays` 가 지난 이벤트를 영수증과 함께 보관 표(월별 파티션, 0005)로 옮긴다.
 *   - 원서마다 가장 큰 순번은 남긴다 — 다음 순번이 MAX()+1 이라 순번이 이어진다
 *   - DEAD·미전송은 옮기지 않는다(사람이 봐야 하고, 아직 보내야 한다)
 *   - 한 번에 `batch` 건, 한 트랜잭션 — 옮기다 실패하면 아무것도 바뀌지 않는다
 * 장기 장애 중에 쌓이는 미전송 이벤트는 여기 대상이 아니다 — 그쪽은 Relay 의 오프라인 한도(offlineSpool)가 본다.
 */
export async function archiveOutbox(db: Db, o: { afterDays: number; keepMonths: number; batch: number }): Promise<ArchiveResult> {
  const oldest = await db.query<{ t: Date | null }>(
    `SELECT min(created_at) AS t FROM outbox_event WHERE status = 'SENT' AND sent_at < now() - make_interval(days => $1)`,
    [o.afterDays],
  );
  const parts = await db.query<{ created: string[]; dropped: string[] }>(`SELECT * FROM outbox_archive_partitions($1, 3, $2)`, [
    oldest.rows[0]?.t ?? null,
    o.keepMonths,
  ]);
  const moved = await db.tx((c) => moveBatch(c, o.afterDays, o.batch));
  archived.add(moved);
  const result = { moved, partitionsCreated: parts.rows[0]?.created ?? [], partitionsDropped: parts.rows[0]?.dropped ?? [] };
  dropped.add(result.partitionsDropped.length);
  return result;
}

async function moveBatch(c: Queryable, afterDays: number, batch: number): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `WITH pick AS (
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
     DELETE FROM outbox_event WHERE id IN (SELECT outbox_event_id FROM receipts) RETURNING id`,
    [afterDays, batch],
  );
  return rows.length;
}

/** 매시간·리더 하나·Peak Mode 억제 구간에는 쉰다 — 멱등 기록 정리와 같은 규칙. 때는 DB 의 마지막 성공으로(periodic-job, D-93) */
@Injectable()
export class OutboxArchiveScheduler implements OnModuleInit, OnApplicationShutdown {
  static readonly LOCK = 'outbox:archive';
  private readonly logger = new Logger('outbox-archive');
  private timer: NodeJS.Timeout | null = null;
  private readonly job: PeriodicJob = { name: 'outbox-archive', university: UNIVERSITY_ID, intervalMs: OUTBOX_ARCHIVE.intervalMs };

  constructor(
    private readonly db: Db,
    @Inject(PEAK_MODE_POLICY) private readonly peakMode: PeakModePolicy = PEAK_MODE,
  ) {}

  onModuleInit(): void {
    if (!OUTBOX_ARCHIVE.autostart) return;
    registerPeriodicJob(this.job);
    this.timer = setInterval(() => void this.safeTick(), checkEveryMs(this.job.intervalMs));
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    try {
      const r = await this.tickIfDue();
      if (r && (r.moved || r.partitionsDropped.length)) {
        this.logger.log(`Outbox ${r.moved}건 보관, 지운 파티션 ${r.partitionsDropped.join(',') || '없음'}`);
      }
    } catch (err) {
      this.logger.warn(`outbox archive failed (${describeFailure(err)})`);
    }
  }

  /** 때가 됐을 때만 — 타이머가 부른다 */
  async tickIfDue(): Promise<ArchiveResult | null> {
    const suspended = shouldSuspendNonCriticalJobs(this.peakMode);
    markSuspended(this.job, suspended);
    if (suspended) return null;
    return runIfDue(this.db, this.job, OutboxArchiveScheduler.LOCK, () => archiveOutbox(this.db, OUTBOX_ARCHIVE), (r) => ({ moved: r.moved, partitionsDropped: r.partitionsDropped.length }));
  }

  async tick(): Promise<ArchiveResult | null> {
    if (shouldSuspendNonCriticalJobs(this.peakMode)) return null;
    return withLeaderLock(this.db, OutboxArchiveScheduler.LOCK, () => archiveOutbox(this.db, OUTBOX_ARCHIVE));
  }
}

@Module({
  providers: [{ provide: PEAK_MODE_POLICY, useValue: PEAK_MODE }, OutboxArchiveScheduler],
})
export class OutboxArchiveModule {}
