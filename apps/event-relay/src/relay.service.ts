import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitSnapshot,
  Db,
  describeFailure,
  httpServerError,
} from '@wonseoro/server-kit';
import { BREAKER, CENTRAL_SYNC_URL, RELAY, UNIVERSITY_ID } from './config';

/** 재시도 상한. 넘으면 DEAD 로 보내고 사람이 본다. */
export const MAX_ATTEMPTS = 10;
/** 지수 Backoff 기준. attempt^2 * BASE + jitter */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 5 * 60_000;

export interface RelayStats {
  sent: number;
  failed: number;
  dead: number;
  /** 중앙이 끊겨 보내지 않고 되돌려 둔 행. 재시도 횟수를 쓰지 않았다. */
  held: number;
  /** 이 주기를 마친 뒤의 중앙 Circuit 상태. */
  circuit: CircuitSnapshot['state'];
}

type SendOutcome = 'SENT' | 'RETRY' | 'DEAD' | 'HELD';

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
 *   5. **중앙 장애 중의 실패는 재시도 횟수를 쓰지 않는다.** (v1.1 §01 C8)
 *
 * 5번이 없으면 무슨 일이 생기는가
 *   재시도 한도가 10회이고 Backoff 가 attempt² × 500ms 라, 중앙이 **2분 반만**
 *   죽어 있어도 그동안 쌓인 이벤트가 전부 DEAD 로 떨어진다. DEAD 는 사람이 손으로
 *   다시 보내야 하는 상태다. 중앙 장애 한 번이 운영자 수작업 수천 건이 된다.
 *
 *   그래서 Circuit Breaker 가 열리면 행을 **집지 않는다.** 이미 집은 행은 횟수를
 *   건드리지 않고 PENDING 으로 되돌린다. 재시도 횟수는 "이 이벤트가 문제인가"를
 *   세는 것이지 "중앙이 살아 있는가"를 세는 것이 아니다.
 */
@Injectable()
export class RelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  /** 중앙 Sync Gateway. 상태는 이 프로세스 안에만 있다. */
  readonly central = new CircuitBreaker({
    name: 'central-sync-gateway',
    failureThreshold: BREAKER.failureThreshold,
    openMs: BREAKER.openMs,
    onStateChange: (c) => {
      const line = `circuit ${c.name} ${c.from} -> ${c.to} (consecutiveFailures=${c.consecutiveFailures})`;
      if (c.to === 'OPEN') this.logger.error(`${line} — 중앙 전송을 멈춘다. 접수는 영향 없다`);
      else this.logger.warn(line);
    },
  });

  constructor(private readonly db: Db) {}

  onModuleInit(): void {
    if (!RELAY.autostart) {
      this.logger.log('relay loop disabled (RELAY_AUTOSTART=false)');
      return;
    }
    const interval = RELAY.intervalMs;
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.log(`relay loop started (every ${interval}ms)`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** 한 주기. 겹쳐 돌지 않게 한다. */
  async tick(): Promise<RelayStats> {
    if (this.running || this.stopped) return this.emptyStats();
    this.running = true;
    try {
      return await this.drainOnce();
    } catch (err) {
      // 루프가 죽으면 안 된다. 다음 주기에 다시 시도한다.
      this.logger.error(`relay tick failed: ${(err as Error).name}`);
      return this.emptyStats();
    } finally {
      this.running = false;
    }
  }

  async drainOnce(): Promise<RelayStats> {
    const stats = this.emptyStats();

    // 끊겨 있으면 집지 않는다. 보내지도 못할 행에 잠금만 걸린다.
    if (!this.central.allowsRequest()) return stats;

    // 반열림이면 탐침 한 건만. 막 살아난 중앙에 밀린 백로그를 한꺼번에 붓지 않는다.
    const batchSize = this.central.state === 'HALF_OPEN' ? 1 : RELAY.batchSize;

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

    for (let i = 0; i < claimed.length; i += 1) {
      const row = claimed[i]!;
      if (this.stopped || !this.central.allowsRequest()) {
        // 배치 중간에 끊겼다. 남은 행은 횟수를 건드리지 않고 되돌린다.
        const rest = claimed.slice(i);
        await this.release(rest);
        stats.held += rest.length;
        break;
      }
      const outcome = await this.send(row);
      if (outcome === 'SENT') stats.sent += 1;
      else if (outcome === 'DEAD') stats.dead += 1;
      else if (outcome === 'HELD') stats.held += 1;
      else stats.failed += 1;
    }

    stats.circuit = this.central.state;
    if (stats.sent || stats.failed || stats.dead || stats.held) {
      this.logger.log(
        `relay: sent=${stats.sent} failed=${stats.failed} dead=${stats.dead} held=${stats.held} circuit=${stats.circuit}`,
      );
    }
    return stats;
  }

  private async send(row: OutboxRow): Promise<SendOutcome> {
    const envelope = {
      specversion: '1.0',
      id: row.id,
      source: `urn:k-admission:university:${UNIVERSITY_ID}`,
      type: row.event_type,
      subject: row.aggregate_id,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      dataschema: 'https://schemas.k-admission.kr/events/bundle/v1.json',
      // 확장 속성. §04 가 규정한 이름 그대로여야 한다.
      kadmissionuniversity: UNIVERSITY_ID,
      kadmissionsequence: Number(row.aggregate_sequence),
      configversion: String(row.payload.configVersion ?? ''),
      policyversion: String(row.payload.policyVersion ?? ''),
      data: row.payload,
    };

    let res: Response;
    try {
      res = await this.central.run(
        () =>
          fetch(`${this.centralUrl()}/internal/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/cloudevents+json' },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(RELAY.timeoutMs),
          }),
        // 4xx 는 중앙이 살아서 거절한 것이다. 5xx·연결 실패만 장애로 센다.
        { isFailure: httpServerError },
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        await this.release([row]);
        return 'HELD';
      }
      // 중앙이 꺼져 있다. 정상 상황이다. 쌓아두고 나중에 보낸다.
      return this.failedByCentral(row, describeFailure(err));
    }

    // 202 = 새로 받음, 409 = 이미 받음. 둘 다 "중앙이 알고 있다"는 뜻이므로 성공이다.
    if (res.status === 202 || res.status === 409) {
      const body = (await res.json()) as { receiptId?: string; acknowledgedAt?: string };
      await this.markSent(row, body.receiptId ?? '', body.acknowledgedAt);
      return 'SENT';
    }

    // 400 대는 재시도해도 안 된다. 바로 DEAD 로 보낸다.
    if (res.status >= 400 && res.status < 500) {
      await this.markDead(row, `central rejected ${res.status}`);
      return 'DEAD';
    }

    return this.failedByCentral(row, `central ${res.status}`);
  }

  /**
   * 중앙 쪽 실패(연결 실패·타임아웃·5xx)를 처리한다.
   *
   * 이 실패로 회로가 열렸다면 — 또는 탐침이 실패해 닫히지 못했다면 — 중앙 장애다.
   * 이벤트의 재시도 횟수를 쓰지 않고 되돌린다.
   * 회로가 아직 닫혀 있으면 이 이벤트만의 문제일 수 있으므로 평소처럼 센다.
   */
  private async failedByCentral(row: OutboxRow, reason: string): Promise<SendOutcome> {
    if (this.central.state !== 'CLOSED') {
      await this.release([row]);
      return 'HELD';
    }
    return (await this.scheduleRetry(row, reason)) ? 'DEAD' : 'RETRY';
  }

  /** 집었던 행을 그대로 돌려놓는다. attempt_count·next_attempt_at 은 건드리지 않는다. */
  private async release(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `UPDATE outbox_event SET status = 'PENDING'
        WHERE id = ANY($1::uuid[]) AND status = 'SENDING'`,
      [rows.map((r) => r.id)],
    );
  }

  private emptyStats(): RelayStats {
    return { sent: 0, failed: 0, dead: 0, held: 0, circuit: this.central.state };
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

  /** 재시도를 예약한다. 한도를 넘겨 DEAD 로 보냈으면 true. */
  private async scheduleRetry(row: OutboxRow, reason: string): Promise<boolean> {
    const attempt = row.attempt_count + 1;
    if (attempt >= MAX_ATTEMPTS) {
      await this.markDead(row, reason);
      return true;
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
    return false;
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
    circuit: CircuitSnapshot;
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
      universityId: UNIVERSITY_ID,
      pendingCount: Number(r.pending ?? 0),
      oldestPendingAgeSeconds: Math.floor(Number(r.oldest ?? 0)),
      deadCount: Number(r.dead ?? 0),
      // 적체가 느는데 회로가 열려 있으면 중앙 장애, 닫혀 있으면 relay 쪽 문제다.
      circuit: this.central.snapshot(),
    };
  }

  private centralUrl(): string {
    return CENTRAL_SYNC_URL;
  }
}
