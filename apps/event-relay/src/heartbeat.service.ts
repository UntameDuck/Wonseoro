import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_TYPE } from '@wonseoro/contracts';
import { CircuitOpenError, Db, describeFailure, httpServerError, traceHeaders } from '@wonseoro/server-kit';
import { CENTRAL_SYNC_URL, PLATFORM_VERSION, RELAY, UNIVERSITY_ID } from './config';
import { RelayService } from './relay.service';

/** 심장박동 본문 — CloudEvents 스키마 SyncHeartbeatData (additionalProperties: false). */
export interface HeartbeatData {
  universityId: string;
  platformVersion: string;
  configVersion: string;
  pendingOutbox: number;
  oldestPendingAgeSeconds: number;
  clockOffsetMs?: number;
}

/**
 * 대학 상태 심장박동 — 기술설계서 v1.1 §04 `kr.kadmission.sync.heartbeat.v1` (D-60)
 *
 * 이벤트는 원서가 접수·취소될 때만 나간다. 그래서 중앙은 **조용한 대학과 죽은 대학을 구별하지
 * 못했다** — 마지막 이벤트가 두 시간 전이면 두 시간 동안 접수가 없었던 것인지, 대학 서버가
 * 두 시간째 멈춘 것인지 모른다. 스키마와 중앙 DDL(university_sync_state.last_heartbeat_at …)에
 * 자리는 있었지만 아무도 보내지 않았다.
 *
 * 주기마다 이 대학의 적체(대기 이벤트 수·가장 오래된 대기 시간)·적용 설정 버전·시계 offset 을 보낸다.
 *   - Outbox 에 넣지 않는다. 심장박동은 "지금" 의 상태다 — 중앙이 끊긴 동안 쌓아 두었다가
 *     나중에 보내면 지난 상태가 현재처럼 보인다. 끊겼으면 건너뛴다
 *   - 이벤트 전송과 같은 중앙 회로 차단기를 쓴다. 끊겨 있으면 묻지도 않는다
 *   - Relay 가 여럿이면 각자 보낸다. 중앙은 마지막 값으로 덮으므로 해가 없다
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('sync-heartbeat');
  private timer: NodeJS.Timeout | null = null;
  private failing = false;

  constructor(
    private readonly db: Db,
    private readonly relay: RelayService,
  ) {}

  onModuleInit(): void {
    if (!RELAY.autostart) return;
    this.timer = setInterval(() => void this.beat(), RELAY.heartbeatMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 지금 상태. 시험에서 직접 부른다. */
  async snapshot(): Promise<HeartbeatData> {
    const backlog = await this.relay.backlog();
    // 모집 중인 주기의 적용 설정. 없으면 'none' — 설정 없이 접수를 받는 대학이라는 신호다.
    const { rows } = await this.db.query<{ version: string }>(
      `SELECT c.version FROM config_version c
         JOIN admission_cycle y ON y.id = c.cycle_id
        WHERE c.status = 'ACTIVE' AND y.status = 'OPEN'
        ORDER BY c.activated_at DESC NULLS LAST
        LIMIT 1`,
    );
    const offset = await this.clockOffsetMs();
    return {
      universityId: UNIVERSITY_ID,
      platformVersion: PLATFORM_VERSION,
      configVersion: rows[0]?.version ?? 'none',
      pendingOutbox: backlog.pendingCount,
      oldestPendingAgeSeconds: backlog.oldestPendingAgeSeconds,
      ...(offset === null ? {} : { clockOffsetMs: offset }),
    };
  }

  /** 한 번 보낸다. 보냈으면 true. 중앙이 끊겼거나 거절했으면 false — 쌓지 않는다. */
  async beat(): Promise<boolean> {
    try {
      if (!this.relay.central.allowsRequest()) return false;
      const data = await this.snapshot();
      const now = new Date();
      const envelope = {
        specversion: '1.0',
        id: randomUUID(),
        source: `urn:k-admission:university:${UNIVERSITY_ID}`,
        type: EVENT_TYPE.SYNC_HEARTBEAT,
        subject: `university:${UNIVERSITY_ID}`,
        time: now.toISOString(),
        datacontenttype: 'application/json',
        dataschema: 'https://schemas.k-admission.kr/events/bundle/v1.json',
        kadmissionuniversity: UNIVERSITY_ID,
        // 원서 이벤트와 달리 순서 원장이 아니다. 초 단위 시각으로 단조 증가만 지킨다 — 중앙은 이 값으로 gap 을 보지 않는다.
        kadmissionsequence: Math.max(1, Math.floor(now.getTime() / 1000)),
        configversion: data.configVersion,
        data,
      };
      const res = await this.relay.central.run(
        () =>
          fetch(`${CENTRAL_SYNC_URL}/internal/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/cloudevents+json', ...traceHeaders() },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(RELAY.timeoutMs),
          }),
        { isFailure: httpServerError },
      );
      if (res.status !== 202) {
        this.logger.warn(`heartbeat rejected ${res.status}`);
        return false;
      }
      if (this.failing) this.logger.log('중앙에 심장박동 전송 복구');
      this.failing = false;
      return true;
    } catch (err) {
      if (err instanceof CircuitOpenError) return false;
      // 중앙이 꺼져 있는 것은 정상 상황이다. 한 번만 남긴다.
      if (!this.failing) this.logger.warn(`heartbeat failed (${describeFailure(err)})`);
      this.failing = true;
      return false;
    }
  }

  /** 이 Relay 노드 시계 − DB 시계. 한 번 재고 왕복의 한가운데를 기준으로 한다. 못 재면 null. */
  private async clockOffsetMs(): Promise<number | null> {
    try {
      const sent = Date.now();
      const { rows } = await this.db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`);
      const received = Date.now();
      const db = rows[0]?.now;
      return db ? Math.round(sent + (received - sent) / 2 - db.getTime()) : null;
    } catch {
      return null;
    }
  }
}
