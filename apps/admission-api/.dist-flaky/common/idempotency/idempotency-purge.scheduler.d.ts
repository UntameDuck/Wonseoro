import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { PeakModePolicy } from '../scheduling/peak-mode';
import { IdempotencyStore } from './idempotency.store';
/**
 * 만료된 멱등 기록 정리 (D-11).
 *
 * 기록은 24시간 뒤 만료되지만 지우는 쪽이 없었다(`purgeExpired` 가 어디서도 불리지 않았다).
 * 마감 피크의 모든 변경 요청이 한 행씩 남아 표가 끝없이 자란다.
 *
 * 대조 스케줄러와 같은 규칙이다 — Pod 가 여럿이어도 한 곳만 돈다(세션 advisory lock),
 * Peak Mode 억제 구간에는 쉰다. 한 번에 정해진 건수씩 지우고, 남았으면 다음 주기에 이어서 지운다.
 */
export declare class IdempotencyPurgeScheduler implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly store;
    private readonly peakMode;
    static readonly LOCK = "idempotency:purge";
    private readonly logger;
    private timer;
    constructor(db: Db, store: IdempotencyStore, peakMode?: PeakModePolicy);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    private safeTick;
    /** Peak Mode 로 억제됐거나 다른 Pod 가 돌고 있으면 null. */
    tick(): Promise<number | null>;
}
