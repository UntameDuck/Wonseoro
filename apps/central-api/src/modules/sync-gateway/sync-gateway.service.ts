import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db, isPurposeRef } from '@wonseoro/server-kit';
import { EVENT_TYPE } from '@wonseoro/contracts';
import { HEARTBEAT_STALE_SECONDS } from '../../config';

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
    // 심장박동은 원서 원장이 아니다 — 수신 원장·sequence gap·요약을 거치지 않는다. (D-60)
    if (event?.type === EVENT_TYPE.SYNC_HEARTBEAT) return this.heartbeat(event);
    this.validate(event);
    await this.assertRegistered(event.kadmissionuniversity);

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
          event.configversion || null,
          event.policyversion || null,
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
        // 설정 버전이 없는 이벤트(접수 전 취소)가 알던 버전을 지우지 않게 한다.
        `INSERT INTO university_sync_state (university_id, config_version, last_event_at)
         VALUES ($1,$2,now())
         ON CONFLICT (university_id) DO UPDATE
           SET config_version = COALESCE(EXCLUDED.config_version, university_sync_state.config_version),
               last_event_at = now(),
               updated_at = now()`,
        [universityId, event.configversion || null],
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

  /**
   * 관제용. 어느 대학이 얼마나 밀려 있는가, 지금 살아 있는가.
   * `reachable` 은 심장박동으로 판단한다 — 마지막 이벤트 시각으로는 조용한 대학과 죽은 대학을 가릴 수 없다.
   */
  async syncStatus(): Promise<
    Array<{
      universityId: string;
      name: string;
      lastEventAt: string | null;
      lastHeartbeatAt: string | null;
      reachable: boolean;
      pendingOutbox: number | null;
      oldestPendingAgeSeconds: number | null;
      clockOffsetMs: number | null;
      configVersion: string | null;
      platformVersion: string | null;
      openGaps: number;
      summaries: number;
    }>
  > {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT u.id AS university_id, u.name,
              s.last_event_at, s.last_heartbeat_at, s.pending_outbox, s.oldest_pending_age_seconds,
              s.clock_offset_ms, s.config_version, s.platform_version,
              (s.last_heartbeat_at IS NOT NULL
                AND s.last_heartbeat_at > now() - make_interval(secs => $1)) AS reachable,
              (SELECT count(*) FROM sync_gap g
                WHERE g.university_id = u.id AND g.state = 'OPEN') AS open_gaps,
              (SELECT count(*) FROM application_summary a
                WHERE a.university_id = u.id) AS summaries
         FROM university_registry u
         LEFT JOIN university_sync_state s ON s.university_id = u.id
        ORDER BY u.id`,
      [HEARTBEAT_STALE_SECONDS],
    );
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return rows.map((r) => ({
      universityId: String(r.university_id),
      name: String(r.name),
      lastEventAt: r.last_event_at ? (r.last_event_at as Date).toISOString() : null,
      lastHeartbeatAt: r.last_heartbeat_at ? (r.last_heartbeat_at as Date).toISOString() : null,
      reachable: r.reachable === true,
      pendingOutbox: num(r.pending_outbox),
      oldestPendingAgeSeconds: num(r.oldest_pending_age_seconds),
      clockOffsetMs: num(r.clock_offset_ms),
      configVersion: r.config_version ? String(r.config_version) : null,
      platformVersion: r.platform_version ? String(r.platform_version) : null,
      openGaps: Number(r.open_gaps),
      summaries: Number(r.summaries),
    }));
  }

  /**
   * 대학 심장박동 (§04 sync.heartbeat, D-60). 대학 상태의 "지금" 을 덮어쓴다.
   * 수신 원장에 남기지 않는다 — 원서 원장이 아니고, 60초마다 오는 행을 쌓을 이유가 없다.
   * 같은 심장박동이 두 번 와도 결과가 같다(덮어쓰기).
   */
  private async heartbeat(event: IncomingEvent): Promise<IngestResult> {
    if (event.specversion !== '1.0') throw new SyncRejection('SPECVERSION', 'CloudEvents 1.0 만 받는다.');
    if (!event.id || !/^urn:k-admission:university:[A-Za-z0-9_-]+$/.test(event.source ?? '')) {
      throw new SyncRejection('ENVELOPE', 'id·source 가 올바르지 않다.');
    }
    const universityId = event.kadmissionuniversity;
    if (event.source.split(':').pop() !== universityId) {
      throw new SyncRejection('IDENTITY', 'source 와 kadmissionuniversity 가 일치하지 않는다.');
    }
    const d = (event.data ?? {}) as Record<string, unknown>;
    const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
    const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64;
    if (
      d.universityId !== universityId ||
      !text(d.platformVersion) ||
      !text(d.configVersion) ||
      !count(d.pendingOutbox) ||
      !count(d.oldestPendingAgeSeconds) ||
      (d.clockOffsetMs !== undefined && !(typeof d.clockOffsetMs === 'number' && Number.isInteger(d.clockOffsetMs)))
    ) {
      throw new SyncRejection('DATA', '심장박동 본문이 스키마(SyncHeartbeatData)와 다르다.');
    }
    await this.assertRegistered(universityId);

    await this.db.query(
      `INSERT INTO university_sync_state
         (university_id, platform_version, config_version, last_heartbeat_at,
          pending_outbox, oldest_pending_age_seconds, clock_offset_ms)
       VALUES ($1,$2,$3,now(),$4,$5,$6)
       ON CONFLICT (university_id) DO UPDATE
         SET platform_version = EXCLUDED.platform_version,
             config_version = EXCLUDED.config_version,
             last_heartbeat_at = now(),
             pending_outbox = EXCLUDED.pending_outbox,
             oldest_pending_age_seconds = EXCLUDED.oldest_pending_age_seconds,
             clock_offset_ms = EXCLUDED.clock_offset_ms,
             updated_at = now()`,
      [
        universityId,
        d.platformVersion,
        d.configVersion,
        d.pendingOutbox,
        d.oldestPendingAgeSeconds,
        typeof d.clockOffsetMs === 'number' ? d.clockOffsetMs : null,
      ],
    );
    return {
      eventId: event.id,
      receiptId: `HB-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`,
      acknowledgedAt: new Date().toISOString(),
      duplicate: false,
    };
  }

  /**
   * 등록된 대학만 받는다. 전에는 모르는 대학의 이벤트가 외래키 오류로 500 이 되어 Relay 가
   * 중앙 장애로 알고 재시도했다. 400 이면 Relay 는 곧바로 사람이 볼 곳(DEAD)으로 보낸다.
   * 신원 확인 자체는 mTLS 의 일이다 (M5 T-M5-05).
   */
  private async assertRegistered(universityId: string): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM university_registry WHERE id = $1 AND status = 'ACTIVE'`,
      [universityId],
    );
    if (rows.length === 0) {
      throw new SyncRejection('UNKNOWN_UNIVERSITY', `등록되지 않은 대학이다: ${universityId}`);
    }
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
          last_sequence, subject_ref, admission_type_name, department_name, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (university_id, application_id) DO UPDATE
         SET status = EXCLUDED.status,
             -- 한 번 들어온 참조는 덮지 않는다. 이후 이벤트에 빠져 있어도
             -- 이미 연결된 원서가 Dashboard 에서 사라지면 안 된다.
             subject_ref = COALESCE(EXCLUDED.subject_ref, application_summary.subject_ref),
             application_number = COALESCE(EXCLUDED.application_number,
                                           application_summary.application_number),
             submitted_at = COALESCE(EXCLUDED.submitted_at, application_summary.submitted_at),
             -- 표시 이름(T-M5-51). 취소 알림에는 없다 — 있던 이름을 지우지 않는다
             admission_type_name = COALESCE(EXCLUDED.admission_type_name, application_summary.admission_type_name),
             department_name = COALESCE(EXCLUDED.department_name, application_summary.department_name),
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
        // 취소 이벤트 본문에는 상태가 없다(스키마 ApplicationCancelledData) — 이벤트 타입이 곧 상태다. (D-50)
        String(data.status ?? (event.type === EVENT_TYPE.APPLICATION_CANCELLED ? 'CANCELLED' : 'UNKNOWN')),
        data.applicationNumber ? String(data.applicationNumber) : null,
        data.finalizedAt ? String(data.finalizedAt) : (data.submittedAt as string) ?? null,
        sequence,
        // 대학이 보내주지 않으면 null 이다. 그 원서는 Dashboard 에 뜨지 않는다 —
        // 잘못된 사람에게 보여주는 것보다 안 보여주는 쪽이 낫다. (D-27)
        isPurposeRef(data.subjectRef) ? data.subjectRef : null,
        data.admissionTypeName ? String(data.admissionTypeName).slice(0, 200) : null,
        data.departmentName ? String(data.departmentName).slice(0, 200) : null,
      ],
    );
  }
}
