import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
export type OperatingMode = 'CONNECTED' | 'AUTONOMOUS';
export type AutonomousReason = 'CENTRAL_NOT_CONFIGURED' | 'CENTRAL_UNREACHABLE';
export interface SyncBacklog {
    pendingEvents: number;
    oldestPendingAgeSeconds: number;
    deadEvents: number;
    /** 중앙 반영이 SYNC_LAG_WARN_SECONDS 넘게 밀렸다. */
    lagging: boolean;
}
export interface OperatingState {
    mode: OperatingMode;
    reason: AutonomousReason | null;
    /** 이 모드에 들어간 시각. 기동 후 한 번도 바뀌지 않았으면 기동 시각. */
    since: string;
    /** 중앙과 마지막으로 통한 시각. 한 번도 못 했으면 null */
    lastCentralContactAt: string | null;
    sync: SyncBacklog;
    /** 이 상태를 확인한 시각. 화면이 "언제 기준인지" 를 보이려고. */
    checkedAt: string;
}
/**
 * Central Dependency Health Gate — 기술설계서 v1.1 §01 A1·C3
 *
 * **이 대학 서버가 지금 중앙 없이 돌고 있는가**를 판단해 둔다.
 *
 * 판단이 바꾸는 것은 **안내뿐이다.** 접수 경로는 원래 중앙을 거치지 않는다.
 * AUTONOMOUS 라고 해서 막히는 기능이 생기면 안 되고, 실제로 없다.
 * 이 판단이 필요한 이유는 사람 쪽이다.
 *   - 지원자는 "내 원서" (중앙 통합 조회) 에 접수가 안 보이면 접수가 안 된 줄 알고
 *     다시 결제하거나 입학처에 전화한다. 먼저 알려줘야 한다
 *   - 운영자는 중앙이 언제부터 끊겼고 얼마나 밀렸는지 알아야 한다. (§B7)
 *
 * 화면 조회는 메모리의 마지막 확인 결과만 읽는다. 마감 피크에 수천 명이
 * 물어도 중앙과 DB 에는 CENTRAL_GATE_INTERVAL_MS 간격으로만 간다.
 *
 * 판단은 Pod 마다 따로 한다. 같은 대학의 Pod 끼리 잠깐 다르게 보일 수 있지만,
 * 공유 저장소에 두면 그것이 새 의존성이 된다.
 */
export declare class CentralHealthGate implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly breakers;
    private readonly logger;
    private timer;
    private running;
    /** 시험에서 바꿀 수 있게 필드로 둔다. */
    centralUrl: string;
    private state;
    /** 적체 경보를 한 번만 내기 위해. 매 주기 같은 경보를 남기면 로그가 묻힌다. */
    private lagAlarmRaised;
    /**
     * AUTONOMOUS 경보를 냈는가.
     * 모드 "전환" 만 보면 기동할 때부터 중앙이 없던 경우를 놓친다 — 초기 상태가 이미
     * AUTONOMOUS 라 전환이 일어나지 않는다. 운영자가 가장 알아야 할 경우가 그것이다.
     */
    private autonomousAnnounced;
    constructor(db: Db, breakers: DependencyBreakers);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    current(): OperatingState;
    /**
     * 한 주기. 중앙을 확인하고 적체를 센다.
     * `probe` 는 시험에서 중앙 응답을 흉내 내려고 받는다.
     */
    tick(probe?: () => Promise<Response>): Promise<OperatingState>;
    private checkCentral;
    private httpProbe;
    /**
     * Outbox 적체. relay 는 별도 프로세스지만 같은 DB 를 보므로 여기서 직접 센다.
     * relay 가 죽어도 적체는 보여야 한다 — relay 에 물으면 그때 함께 안 보인다.
     */
    private readBacklog;
    private update;
    private reportMode;
    /** 적체 경보는 넘어설 때 한 번, 풀릴 때 한 번. (§B7 backlog age alert) */
    private reportLag;
}
