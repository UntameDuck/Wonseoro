import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { withLeaderLock } from '../scheduling/leader-lock';
import { PeakModePolicy, PEAK_MODE_POLICY, shouldSuspendNonCriticalJobs } from '../scheduling/peak-mode';
import { IDEMPOTENCY_PURGE, PEAK_MODE } from '../../config';
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
@Injectable()
export class IdempotencyPurgeScheduler implements OnModuleInit, OnApplicationShutdown {
  static readonly LOCK = 'idempotency:purge';
  private readonly logger = new Logger('idempotency-purge');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: IdempotencyStore,
    @Inject(PEAK_MODE_POLICY)
    private readonly peakMode: PeakModePolicy = PEAK_MODE,
  ) {}

  onModuleInit(): void {
    if (!IDEMPOTENCY_PURGE.autostart) return;
    this.timer = setInterval(() => void this.safeTick(), IDEMPOTENCY_PURGE.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    try {
      const purged = await this.tick();
      if (purged) this.logger.log(`만료된 멱등 기록 ${purged}건을 지웠다`);
    } catch (err) {
      this.logger.warn(`idempotency purge failed (${describeFailure(err)})`);
    }
  }

  /** Peak Mode 로 억제됐거나 다른 Pod 가 돌고 있으면 null. */
  async tick(): Promise<number | null> {
    if (shouldSuspendNonCriticalJobs(this.peakMode)) return null;
    return withLeaderLock(this.db, IdempotencyPurgeScheduler.LOCK, () => this.store.purgeExpired());
  }
}
