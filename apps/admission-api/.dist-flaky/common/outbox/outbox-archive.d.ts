import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { PeakModePolicy } from '../scheduling/peak-mode';
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
export declare function archiveOutbox(db: Db, o: {
    afterDays: number;
    keepMonths: number;
    batch: number;
}): Promise<ArchiveResult>;
/** 매시간·리더 하나·Peak Mode 억제 구간에는 쉰다 — 멱등 기록 정리와 같은 규칙 */
export declare class OutboxArchiveScheduler implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly peakMode;
    static readonly LOCK = "outbox:archive";
    private readonly logger;
    private timer;
    constructor(db: Db, peakMode?: PeakModePolicy);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    private safeTick;
    tick(): Promise<ArchiveResult | null>;
}
export declare class OutboxArchiveModule {
}
