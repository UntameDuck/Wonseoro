import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { CENTRAL_GATE } from '../../config';

/**
 * DB 에서 읽는 업무 KPI 게이지 (T-M4-22·23, v1.0 §15·§10.4).
 *
 *   outbox_backlog               전송 대기(PENDING·SENDING) 이벤트 수        — Support "outbox backlog"
 *   outbox_oldest_age_seconds    가장 오래 기다린 전송 대기 이벤트의 나이     — Relay 작업 큐가 얼마나 밀렸나
 *   outbox_dead_events           재시도를 멈춘(DEAD) 이벤트 수               — 사람이 봐야 한다
 *   central_sync_lag_seconds     중앙이 아직 모르는 가장 오래된 이벤트의 나이 — DEAD 포함. 중앙 "내 원서" 가 얼마나 늦나
 *   document_scan_pending        검사 대기(QUARANTINED) 서류 수
 *   db_lock_waiting_sessions     행 잠금을 기다리는 앱 세션 수                — Support "DB lock wait"
 *   central_sync_lag_warn_seconds 중앙 반영 지연 경보 기준(설정 SYNC_LAG_WARN_SECONDS) — 경보 규칙이 같은 기준을 쓰게
 *
 * 스크레이프마다 DB 에 묻지 않는다. REFRESH_MS 마다 한 번 읽어 두고 게이지 콜백은 그 값만 낸다.
 * Pod 마다 같은 값을 내므로 대시보드는 max() 로 모은다. 읽기가 실패하면 값을 내지 않는다 —
 * 0 을 내면 "적체 없음" 으로 오해한다.
 *
 * db_lock_waiting_sessions 는 앱 역할이 볼 수 있는 자기 세션만 센다(pg_monitor 권한을 앱에 주지 않는다).
 * DB 전체 잠금은 운영 DB 관측(postgres_exporter 등)의 몫이다.
 */
export interface BusinessSnapshot {
  outboxBacklog: number;
  outboxOldestAgeSeconds: number;
  outboxDeadEvents: number;
  centralSyncLagSeconds: number;
  documentScanPending: number;
  dbLockWaitingSessions: number;
}

const REFRESH_MS = 15_000;

@Injectable()
export class BusinessGauges implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('business-gauges');
  private timer: NodeJS.Timeout | null = null;
  private snapshot: BusinessSnapshot | null = null;
  private failing = false;

  constructor(private readonly db: Db) {
    const meter = metrics.getMeter('k-admission.business');
    const gauge = (name: string, description: string, unit: string, pick: (s: BusinessSnapshot) => number) => {
      meter
        .createObservableGauge(name, { description, unit })
        .addCallback((result) => {
          if (this.snapshot) result.observe(pick(this.snapshot));
        });
    };
    gauge('outbox_backlog', '전송 대기 Outbox 이벤트 수', '{event}', (s) => s.outboxBacklog);
    gauge('outbox_oldest_age_seconds', '가장 오래 기다린 전송 대기 이벤트의 나이', 's', (s) => s.outboxOldestAgeSeconds);
    gauge('outbox_dead_events', '재시도를 멈춘 Outbox 이벤트 수', '{event}', (s) => s.outboxDeadEvents);
    gauge('central_sync_lag_seconds', '중앙이 아직 모르는 가장 오래된 이벤트의 나이', 's', (s) => s.centralSyncLagSeconds);
    gauge('document_scan_pending', '검사 대기 서류 수', '{document}', (s) => s.documentScanPending);
    gauge('db_lock_waiting_sessions', '행 잠금을 기다리는 앱 세션 수', '{session}', (s) => s.dbLockWaitingSessions);
    // 경보 CentralSyncLagging 이 앱의 지연 기준(SYNC_LAG_WARN_SECONDS — 로그 경보와 같은 값)을 보게 내보낸다 (D-93)
    meter
      .createObservableGauge('central_sync_lag_warn_seconds', { description: '중앙 반영 지연 경보 기준', unit: 's' })
      .addCallback((result) => result.observe(CENTRAL_GATE.syncLagWarnSeconds));
  }

  onModuleInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 시험에서 직접 부른다. */
  async refresh(): Promise<BusinessSnapshot | null> {
    try {
      this.snapshot = await this.read();
      if (this.failing) this.logger.log('KPI 게이지 읽기 복구');
      this.failing = false;
    } catch (error) {
      this.snapshot = null;
      if (!this.failing) this.logger.warn(`KPI 게이지를 읽지 못했다: ${describeFailure(error)}`);
      this.failing = true;
    }
    return this.snapshot;
  }

  private async read(): Promise<BusinessSnapshot> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT
         (SELECT count(*) FROM outbox_event WHERE status IN ('PENDING','SENDING')) AS backlog,
         (SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
            FROM outbox_event WHERE status IN ('PENDING','SENDING')) AS oldest,
         (SELECT count(*) FROM outbox_event WHERE status = 'DEAD') AS dead,
         (SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
            FROM outbox_event WHERE status <> 'SENT') AS lag,
         (SELECT count(*) FROM document WHERE status = 'QUARANTINED') AS scan_pending,
         (SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock') AS lock_waiting`,
    );
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
}
