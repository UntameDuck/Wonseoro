import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
/**
 * DB 에서 읽는 업무 KPI 게이지 (T-M4-22·23, v1.0 §15·§10.4).
 *
 *   outbox_backlog               전송 대기(PENDING·SENDING) 이벤트 수        — Support "outbox backlog"
 *   outbox_oldest_age_seconds    가장 오래 기다린 전송 대기 이벤트의 나이     — Relay 작업 큐가 얼마나 밀렸나
 *   outbox_dead_events           재시도를 멈춘(DEAD) 이벤트 수               — 사람이 봐야 한다
 *   central_sync_lag_seconds     중앙이 아직 모르는 가장 오래된 이벤트의 나이 — DEAD 포함. 중앙 "내 원서" 가 얼마나 늦나
 *   document_scan_pending        검사 대기(QUARANTINED) 서류 수
 *   db_lock_waiting_sessions     행 잠금을 기다리는 앱 세션 수                — Support "DB lock wait"
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
export declare class BusinessGauges implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly logger;
    private timer;
    private snapshot;
    private failing;
    constructor(db: Db);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    /** 시험에서 직접 부른다. */
    refresh(): Promise<BusinessSnapshot | null>;
    private read;
}
