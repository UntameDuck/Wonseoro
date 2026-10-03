import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { PeakModePolicy } from '../../common/scheduling/peak-mode';
import { ReconcileResult, ReconciliationService } from './reconciliation.service';
/**
 * 대조 자동 실행 — v1.1 §B18 "D+1 자동 대조" (D-40)
 *
 * 사람이 눌러야만 도는 대조는 사고가 난 뒤에야 돈다. 매 intervalMs 마다 최근
 * sinceHours 를 본다. 기본(1시간 · 48시간 창)이면 D+1 을 매시간 덮는다.
 *
 * Pod 가 여럿이어도 한 번만 돈다 (advisory lock). 같은 불일치를 두 Pod 가 동시에
 * 열면 예외 큐가 중복으로 찬다 — `openIfNew` 가 막지만 경합에 기대지 않는다.
 */
export declare class ReconciliationScheduler implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly reconciliation;
    private readonly peakMode;
    static readonly LOCK = "reconciliation:scheduled";
    private readonly logger;
    private timer;
    constructor(db: Db, reconciliation: ReconciliationService, peakMode?: PeakModePolicy);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    private safeTick;
    /** Peak Mode로 억제됐거나 다른 Pod가 돌고 있으면 null. */
    tick(sinceHours?: number): Promise<ReconcileResult | null>;
}
