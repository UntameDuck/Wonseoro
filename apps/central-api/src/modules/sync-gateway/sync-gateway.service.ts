import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '@wonseoro/server-kit';

/** 대학이 보내는 CloudEvent. 확장 속성은 envelope 최상위에 붙는다. (v1.1 §04) */
export interface IncomingEvent {
  specversion: string;
  id: string;
  source: string;
  type: string;
  subject?: string;
  time: string;
  datacontenttype?: string;
  kadmissionuniversity: string;
  kadmissionsequence: number;
  configversion?: string;
  policyversion?: string;
  traceparent?: string;
  data: Record<string, unknown>;
}

export interface IngestResult {
  eventId: string;
  receiptId: string;
  acknowledgedAt: string;
  /** 이미 받은 이벤트인가. 중복 수신은 오류가 아니다. */
  duplicate: boolean;
}

export class SyncRejection extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/**
 * Sync Gateway — 기술설계서 v1.0 §3.1, v1.1 §04·§A3
 *
 * 대학이 보낸 최종접수 이벤트를 받는다.
 *
 * 절대 규칙
 *   1. **dedup key 는 (source, id) 다.** at-least-once 이므로 같은 이벤트가 여러 번 온다.
 *      같은 이벤트를 100번 받아도 상태는 한 번만 바뀐다.
 *   2. sequence 가 건너뛰면 **유실**이다. 조용히 넘기지 않고 gap 으로 기록한다.
 *   3. 늦게 도착한 이벤트(과거 sequence)로 요약을 덮어쓰지 않는다.
 *   4. 중앙은 접수 여부의 판정 근거가 아니다. 대학 DB 가 원장이다. (v1.1 §A3)
 *      여기 저장된 것은 "중앙이 관측한 상태"일 뿐이다.
 */
@Injectable()
export class SyncGatewayService {
  private readonly logger = new Logger(SyncGatewayService.name);

  constructor(private readonly db: Db) {}

  async ingest(event: IncomingEvent): Promise<IngestResult> {
    this.validate(event);

    const universityId = event.kadmissionuniversity;
    const aggregateId = String(event.data.applicationId ?? '');
    const sequence = Number(event.kadmissionsequence);

    return this.db.tx(async (client) => {
      // 1. dedup — (source, event_id) UNIQUE 가 최후의 방어선이다.
      const receiptId = `RCP-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
      const inserted = await client.query(
        `INSERT INTO received_event
           (id, source, event_id, event_type, university_id, aggregate_id,
            aggregate_sequence, config_version, policy_version, trace_id,
            integrity_hash, occurred_at, receipt_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (source, event_id) DO NOTHING`,
        [
          randomUUID(),
          event.source,
          event.id,
          event.type,
          universityId,
          aggregateId,
          sequence,
          event.configversion ?? null,
          event.policyversion ?? null,
          event.traceparent ?? null,
          String(event.data.integrityHash ?? ''),
          event.time,
          receiptId,
        ],
      );

      if (inserted.rowCount === 0) {
        // 이미 받았다. 기존 영수증을 그대로 돌려준다. 상태를 다시 바꾸지 않는다.
        const { rows } = await client.query<{ receipt_id: string; received_at: Date }>(
          `SELECT receipt_id, received_at FROM received_event
            WHERE source = $1 AND event_id = $2`,
          [event.source, event.id],
        );
        const prior = rows[0];
        return {
          eventId: event.id,
          receiptId: prior?.receipt_id ?? receiptId,
          acknowledgedAt: (prior?.received_at ?? new Date()).toISOString(),
          duplicate: true,
        };
      }

      // 2. sequence gap 탐지
      await this.detectGap(client, universityId, aggregateId, sequence);

      // 3. 요약 갱신 — 늦게 온 이벤트가 최신 상태를 덮지 않게 한다.
      await this.upsertSummary(client, event, universityId, aggregateId, sequence);

      // 4. 대학 동기화 상태 갱신
      await client.query(
        `INSERT INTO university_sync_state (university_id, config_version, last_event_at)
         VALUES ($1,$2,now())
         ON CONFLICT (university_id) DO UPDATE
           SET config_version = EXCLUDED.config_version,
               last_event_at = now(),
               updated_at = now()`,
        [universityId, event.configversion ?? null],
      );

      this.logger.log(`ingested ${event.type} seq=${sequence} univ=${universityId}`);
      return {
        eventId: event.id,
        receiptId,
        acknowledgedAt: new Date().toISOString(),
        duplicate: false,
      };
    });
  }

  async receiptOf(eventId: string): Promise<{
    eventId: string;
    receiptId: string;
    acknowledgedAt: string;
    universityId: string;
    sequence: number;
  } | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT event_id, receipt_id, received_at, university_id, aggregate_sequence
         FROM received_event WHERE event_id = $1`,
      [eventId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      eventId: String(r.event_id),
      receiptId: String(r.receipt_id),
      acknowledgedAt: (r.received_at as Date).toISOString(),
      universityId: String(r.university_id),
      sequence: Number(r.aggregate_sequence),
    };
  }

  /** 관제용. 어느 대학이 얼마나 밀려 있는가. */
  async syncStatus(): Promise<
    Array<{
      universityId: string;
      lastEventAt: string | null;
      openGaps: number;
      summaries: number;
    }>
  > {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT u.id AS university_id,
              s.last_event_at,
              (SELECT count(*) FROM sync_gap g
                WHERE g.university_id = u.id AND g.state = 'OPEN') AS open_gaps,
              (SELECT count(*) FROM application_summary a
                WHERE a.university_id = u.id) AS summaries
         FROM university_registry u
         LEFT JOIN university_sync_state s ON s.university_id = u.id
        ORDER BY u.id`,
    );
    return rows.map((r) => ({
      universityId: String(r.university_id),
      lastEventAt: r.last_event_at ? (r.last_event_at as Date).toISOString() : null,
      openGaps: Number(r.open_gaps),
      summaries: Number(r.summaries),
    }));
  }

  private validate(event: IncomingEvent): void {
    if (event.specversion !== '1.0') {
      throw new SyncRejection('SPECVERSION', 'CloudEvents 1.0 만 받는다.');
    }
    if (!event.id || !event.source || !event.type) {
      throw new SyncRejection('ENVELOPE', 'id·source·type 은 필수다.');
    }
    if (!/^urn:k-admission:university:[A-Za-z0-9_-]+$/.test(event.source)) {
      // §04 가 source 패턴을 규정한다. 위장 발신을 1차로 거른다.
      // 실제 신원 확인은 mTLS 다. (M5 T-M5-05)
      throw new SyncRejection('SOURCE', 'source 형식이 올바르지 않다.');
    }
    if (!event.kadmissionuniversity) {
      throw new SyncRejection('EXTENSION', 'kadmissionuniversity 확장 속성이 없다.');
    }
    if (!Number.isInteger(event.kadmissionsequence) || event.kadmissionsequence < 1) {
      throw new SyncRejection('SEQUENCE', 'kadmissionsequence 는 1 이상 정수여야 한다.');
    }
    if (!event.data?.applicationId) {
      throw new SyncRejection('DATA', 'data.applicationId 가 없다.');
    }
    // source 와 확장 속성의 대학이 다르면 위장이다.
    const fromSource = event.source.split(':').pop();
    if (fromSource !== event.kadmissionuniversity) {
      throw new SyncRejection('IDENTITY', 'source 와 kadmissionuniversity 가 일치하지 않는다.');
    }
  }

  /**
   * sequence 는 Application 별 단조 증가다. (v1.1 §A3)
   * 1 다음에 3 이 오면 2 가 유실된 것이다. 자동으로 메울 수 없으므로 기록하고 경보한다.
   */
  private async detectGap(
    client: Parameters<Parameters<Db['tx']>[0]>[0],
    universityId: string,
    aggregateId: string,
    sequence: number,
  ): Promise<void> {
    const { rows } = await client.query<{ max_seq: string | null }>(
      `SELECT MAX(aggregate_sequence) AS max_seq
         FROM received_event
        WHERE university_id = $1 AND aggregate_id = $2 AND aggregate_sequence < $3`,
      [universityId, aggregateId, sequence],
    );
    const previous = rows[0]?.max_seq ? Number(rows[0].max_seq) : 0;

    for (let missing = previous + 1; missing < sequence; missing += 1) {
      await client.query(
        `INSERT INTO sync_gap
           (id, university_id, aggregate_id, expected_sequence, observed_sequence, state)
         VALUES ($1,$2,$3,$4,$5,'OPEN')
         ON CONFLICT (university_id, aggregate_id, expected_sequence) DO NOTHING`,
        [randomUUID(), universityId, aggregateId, missing, sequence],
      );
      this.logger.warn(
        `MISSING_SEQUENCE univ=${universityId} aggregate=${aggregateId} expected=${missing}`,
      );
    }

    // 늦게 도착한 이벤트가 기존 gap 을 메웠는지 확인한다.
    await client.query(
      `UPDATE sync_gap SET state = 'RESOLVED', resolved_at = now()
        WHERE university_id = $1 AND aggregate_id = $2
          AND expected_sequence = $3 AND state = 'OPEN'`,
      [universityId, aggregateId, sequence],
    );
  }

  private async upsertSummary(
    client: Parameters<Parameters<Db['tx']>[0]>[0],
    event: IncomingEvent,
    universityId: string,
    aggregateId: string,
    sequence: number,
  ): Promise<void> {
    const data = event.data;
    await client.query(
      `INSERT INTO application_summary
         (university_id, application_id, admission_year, admission_type_code,
          department_code, status, application_number, submitted_at,
          last_sequence, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (university_id, application_id) DO UPDATE
         SET status = EXCLUDED.status,
             application_number = COALESCE(EXCLUDED.application_number,
                                           application_summary.application_number),
             submitted_at = COALESCE(EXCLUDED.submitted_at, application_summary.submitted_at),
             last_sequence = EXCLUDED.last_sequence,
             last_synced_at = now()
       -- 늦게 도착한 과거 이벤트로 최신 상태를 덮지 않는다. (v1.1 §A3 OUT_OF_ORDER)
       WHERE application_summary.last_sequence < EXCLUDED.last_sequence`,
      [
        universityId,
        aggregateId,
        Number(data.admissionYear ?? 0),
        String(data.admissionTypeCode ?? ''),
        String(data.departmentCode ?? ''),
        String(data.status ?? 'UNKNOWN'),
        data.applicationNumber ? String(data.applicationNumber) : null,
        data.finalizedAt ? String(data.finalizedAt) : (data.submittedAt as string) ?? null,
        sequence,
      ],
    );
  }
}
