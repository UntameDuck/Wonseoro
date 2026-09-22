import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';

/** 재시도 상한. 넘으면 DEAD 로 보내고 사람이 본다. */
export const MAX_ATTEMPTS = 10;
/** 지수 Backoff 기준. attempt^2 * BASE + jitter */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 5 * 60_000;

export interface RelayStats {
  sent: number;
  failed: number;
  dead: number;
}

interface OutboxRow {
  id: string;
  aggregate_id: string;
  aggregate_sequence: string;
  event_type: string;
  schema_version: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

/**
 * Outbox Relay — 기술설계서 v1.0 §7.3, v1.1 §04
 *
 * 대학 DB 의 `outbox_event` 를 중앙 Sync Gateway 로 보낸다.
 *
 * **이 프로세스가 죽어도, 중앙이 죽어도, 접수는 이미 끝나 있다.**
 * Finalize 트랜잭션이 커밋된 순간 사용자에게는 접수완료다.
 * 여기서 하는 일은 그 사실을 중앙에 알리는 것뿐이다.
 *
 * 절대 규칙
 *   1. 전송 실패가 접수 API 로 **절대 전파되지 않는다.** 별도 프로세스인 이유다.
 *   2. 중앙 ACK 를 받은 이벤트만 `SENT` 로 바꾼다.
 *   3. At-least-once 다. 중앙이 idempotent 해야 한다 (dedup key = source + id).
 *   4. 중앙 장기 장애에도 Outbox 는 계속 쌓일 수 있어야 한다. (v1.1 §B7)
 */
@Injectable()
export class RelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly db: Db) {}

  onModuleInit(): void {
    if (process.env.RELAY_AUTOSTART === 'false') {
      this.logger.log('relay loop disabled (RELAY_AUTOSTART=false)');
      return;
    }
    const interval = Number(process.env.RELAY_INTERVAL_MS ?? 2000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.log(`relay loop started (every ${interval}ms)`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** 한 주기. 겹쳐 돌지 않게 한다. */
  async tick(): Promise<RelayStats> {
    if (this.running || this.stopped) return { sent: 0, failed: 0, dead: 0 };
    this.running = true;
    try {
      return await this.drainOnce();
    } catch (err) {
      // 루프가 죽으면 안 된다. 다음 주기에 다시 시도한다.
      this.logger.error(`relay tick failed: ${(err as Error).name}`);
      return { sent: 0, failed: 0, dead: 0 };
    } finally {
      this.running = false;
    }
  }

  async drainOnce(): Promise<RelayStats> {
    const batchSize = Number(process.env.RELAY_BATCH_SIZE ?? 100);
    const stats: RelayStats = { sent: 0, failed: 0, dead: 0 };

    // 보낼 것을 집는다. next_attempt_at 이 지난 것만.
    // FOR UPDATE SKIP LOCKED 로 여러 relay 인스턴스가 같은 행을 집지 않게 한다.
    const claimed = await this.db.tx(async (client) => {
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, aggregate_id, aggregate_sequence, event_type, schema_version,
                payload, attempt_count
           FROM outbox_event
          WHERE status IN ('PENDING','SENDING')
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY aggregate_id, aggregate_sequence
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length > 0) {
        await client.query(
          `UPDATE outbox_event SET status = 'SENDING' WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)],
        );
      }
      return rows;
    });

    for (const row of claimed) {
      if (this.stopped) break;
      const ok = await this.send(row);
      if (ok) {
        stats.sent += 1;
      } else if (row.attempt_count + 1 >= MAX_ATTEMPTS) {
        stats.dead += 1;
      } else {
        stats.failed += 1;
      }
    }

    if (stats.sent || stats.failed || stats.dead) {
      this.logger.log(`relay: sent=${stats.sent} failed=${stats.failed} dead=${stats.dead}`);
    }
    return stats;
  }

  private async send(row: OutboxRow): Promise<boolean> {
    const universityId = process.env.UNIVERSITY_ID ?? 'UNKNOWN';
    const envelope = {
      specversion: '1.0',
      id: row.id,
      source: `urn:k-admission:university:${universityId}`,
      type: row.event_type,
      subject: row.aggregate_id,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      dataschema: 'https://schemas.k-admission.kr/events/bundle/v1.json',
      // 확장 속성. §04 가 규정한 이름 그대로여야 한다.
      kadmissionuniversity: universityId,
      kadmissionsequence: Number(row.aggregate_sequence),
      configversion: String(row.payload.configVersion ?? ''),
      policyversion: String(row.payload.policyVersion ?? ''),
      data: row.payload,
    };

    try {
      const res = await fetch(`${this.centralUrl()}/internal/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/cloudevents+json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(Number(process.env.RELAY_TIMEOUT_MS ?? 5000)),
      });

      // 202 = 새로 받음, 409 = 이미 받음. 둘 다 "중앙이 알고 있다"는 뜻이므로 성공이다.
      if (res.status === 202 || res.status === 409) {
        const body = (await res.json()) as { receiptId?: string; acknowledgedAt?: string };
        await this.markSent(row, body.receiptId ?? '', body.acknowledgedAt);
        return true;
      }

      // 400 대는 재시도해도 안 된다. 바로 DEAD 로 보낸다.
      if (res.status >= 400 && res.status < 500) {
        await this.markDead(row, `central rejected ${res.status}`);
        return false;
      }

      await this.scheduleRetry(row, `central ${res.status}`);
      return false;
    } catch (err) {
      // 중앙이 꺼져 있다. 정상 상황이다. 쌓아두고 나중에 보낸다.
      await this.scheduleRetry(row, describeNetworkError(err));
      return false;
    }
  }

  private async markSent(row: OutboxRow, receiptId: string, ackAt?: string): Promise<void> {
    await this.db.tx(async (client) => {
      await client.query(
        `UPDATE outbox_event SET status = 'SENT', sent_at = now() WHERE id = $1`,
        [row.id],
      );
      if (receiptId) {
        await client.query(
          `INSERT INTO sync_receipt
             (id, outbox_event_id, central_receipt_id, acknowledged_at, receipt_hash)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           ON CONFLICT (outbox_event_id) DO NOTHING`,
          [row.id, receiptId, ackAt ?? new Date().toISOString(), receiptId],
        );
      }
    });
  }

  private async scheduleRetry(row: OutboxRow, reason: string): Promise<void> {
    const attempt = row.attempt_count + 1;
    if (attempt >= MAX_ATTEMPTS) {
      await this.markDead(row, reason);
      return;
    }
    // 지수 Backoff + Jitter. Jitter 가 없으면 재시도가 한꺼번에 몰린다.
    const base = Math.min(attempt * attempt * BACKOFF_BASE_MS, BACKOFF_CAP_MS);
    const jitter = Math.floor(Math.random() * base * 0.3);
    const delayMs = base + jitter;

    await this.db.query(
      `UPDATE outbox_event
          SET status = 'PENDING',
              attempt_count = $2,
              next_attempt_at = now() + ($3 || ' milliseconds')::interval
        WHERE id = $1`,
      [row.id, attempt, String(delayMs)],
    );
    this.logger.warn(`retry ${attempt}/${MAX_ATTEMPTS} in ${delayMs}ms (${reason})`);
  }

  private async markDead(row: OutboxRow, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE outbox_event SET status = 'DEAD', attempt_count = attempt_count + 1 WHERE id = $1`,
      [row.id],
    );
    // DEAD 는 사람이 봐야 한다. 조용히 버리지 않는다.
    this.logger.error(`DEAD outbox=${row.id} type=${row.event_type} reason=${reason}`);
  }

  /**
   * Outbox 적체 현황. 관제와 `GET /internal/v1/sync/status` 가 쓴다.
   * backlog 가 계속 늘면 중앙이 죽었거나 relay 가 멈춘 것이다. (v1.1 §B7)
   */
  async backlog(): Promise<{
    universityId: string;
    pendingCount: number;
    oldestPendingAgeSeconds: number;
    deadCount: number;
  }> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING')) AS pending,
              count(*) FILTER (WHERE status = 'DEAD') AS dead,
              COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)
                FILTER (WHERE status IN ('PENDING','SENDING')))), 0) AS oldest
         FROM outbox_event`,
    );
    const r = rows[0] ?? {};
    return {
      universityId: process.env.UNIVERSITY_ID ?? 'UNKNOWN',
      pendingCount: Number(r.pending ?? 0),
      oldestPendingAgeSeconds: Math.floor(Number(r.oldest ?? 0)),
      deadCount: Number(r.dead ?? 0),
    };
  }

  private centralUrl(): string {
    return process.env.CENTRAL_SYNC_URL ?? 'http://localhost:3000';
  }
}

/**
 * fetch 실패는 전부 TypeError 로 올라온다. 그대로 로그에 남기면
 * "연결 거부"인지 "DNS 실패"인지 "타임아웃"인지 알 수 없다.
 * 운영에서 중앙 장애와 설정 오류를 구분하려면 cause 를 봐야 한다.
 */
export function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'TIMEOUT';
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code; // ECONNREFUSED / ENOTFOUND / ECONNRESET ...
    return err.name;
  }
  return 'UNKNOWN';
}
