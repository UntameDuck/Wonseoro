import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db, describeFailure } from '@wonseoro/server-kit';
import { withLeaderLock } from '../../common/scheduling/leader-lock';
import { checkEveryMs, markSuspended, registerPeriodicJob, runIfDue, type PeriodicJob } from '../../common/scheduling/periodic-job';
import {
  PeakModePolicy,
  PEAK_MODE_POLICY,
  shouldSuspendNonCriticalJobs,
} from '../../common/scheduling/peak-mode';
import { PEAK_MODE, RECON_SCHEDULE, UNIVERSITY_ID } from '../../config';
import { ReconcileResult, ReconciliationService } from './reconciliation.service';

/**
 * 대조 자동 실행 — v1.1 §B18 "D+1 자동 대조" (D-40)
 *
 * 사람이 눌러야만 도는 대조는 사고가 난 뒤에야 돈다. 매 intervalMs 마다 최근
 * sinceHours 를 본다. 기본(1시간 · 48시간 창)이면 D+1 을 매시간 덮는다.
 *
 * Pod 가 여럿이어도 한 번만 돈다 (advisory lock). 같은 불일치를 두 Pod 가 동시에
 * 열면 예외 큐가 중복으로 찬다 — `openIfNew` 가 막지만 경합에 기대지 않는다.
 *
 * 때는 DB 의 마지막 성공으로 정한다(`periodic-job`, D-93) — 주기보다 자주 다시 뜨는 Pod 들만 있어도 돌고,
 * 계속 실패하면 경보 ScheduledJobStale 이 본다.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnApplicationShutdown {
  static readonly LOCK = 'reconciliation:scheduled';
  private readonly logger = new Logger('reconciliation-schedule');
  private timer: NodeJS.Timeout | null = null;
  private readonly job: PeriodicJob = { name: 'reconciliation', university: UNIVERSITY_ID, intervalMs: RECON_SCHEDULE.intervalMs };

  constructor(
    private readonly db: Db,
    private readonly reconciliation: ReconciliationService,
    @Inject(PEAK_MODE_POLICY)
    private readonly peakMode: PeakModePolicy = PEAK_MODE,
  ) {}

  onModuleInit(): void {
    if (!RECON_SCHEDULE.autostart) return;
    registerPeriodicJob(this.job);
    this.timer = setInterval(() => void this.safeTick(), checkEveryMs(this.job.intervalMs));
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tickIfDue();
    } catch (err) {
      this.logger.warn(`scheduled reconcile failed (${describeFailure(err)})`);
    }
  }

  /** 때가 됐을 때만 — 타이머가 부른다. 억제·때 아님·다른 Pod 면 null */
  async tickIfDue(sinceHours: number = RECON_SCHEDULE.sinceHours): Promise<ReconcileResult | null> {
    const suspended = shouldSuspendNonCriticalJobs(this.peakMode);
    markSuspended(this.job, suspended);
    if (suspended) return null;
    return runIfDue(this.db, this.job, ReconciliationScheduler.LOCK, () => this.reconciliation.reconcile(sinceHours));
  }

  /** 지금 바로(때와 상관없이). Peak Mode로 억제됐거나 다른 Pod가 돌고 있으면 null. */
  async tick(sinceHours: number = RECON_SCHEDULE.sinceHours): Promise<ReconcileResult | null> {
    if (shouldSuspendNonCriticalJobs(this.peakMode)) return null;
    return withLeaderLock(this.db, ReconciliationScheduler.LOCK, () =>
      this.reconciliation.reconcile(sinceHours),
    );
  }
}
