import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { withLeaderLock } from '../../common/scheduling/leader-lock';
import { RECON_SCHEDULE } from '../../config';
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
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnApplicationShutdown {
  static readonly LOCK = 'reconciliation:scheduled';
  private readonly logger = new Logger('reconciliation-schedule');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly reconciliation: ReconciliationService,
  ) {}

  onModuleInit(): void {
    if (!RECON_SCHEDULE.autostart) return;
    this.timer = setInterval(() => void this.safeTick(), RECON_SCHEDULE.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.logger.warn(`scheduled reconcile failed (${describeFailure(err)})`);
    }
  }

  /** 다른 Pod 가 돌고 있으면 null. */
  async tick(sinceHours: number = RECON_SCHEDULE.sinceHours): Promise<ReconcileResult | null> {
    return withLeaderLock(this.db, ReconciliationScheduler.LOCK, () =>
      this.reconciliation.reconcile(sinceHours),
    );
  }
}
