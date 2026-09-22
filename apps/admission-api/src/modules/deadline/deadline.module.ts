import { Module } from '@nestjs/common';
import { DeadlinePolicy, DeadlineRule } from '@wonseoro/contracts';
import { DeadlinePolicyPort } from './deadline-policy.port';
import { DeadlineService } from './deadline.service';

/**
 * M1 임시 구현 — 환경변수에서 마감 정책을 읽는다.
 *
 * M3 에서 서명된 정책 버전 + 입학처 2인 승인 엔진으로 교체한다. (T-M3-01)
 * 그때 이 Provider 만 바꾸면 되고 DeadlineService 호출부는 그대로다.
 */
class EnvDeadlinePolicy extends DeadlinePolicyPort {
  async current(admissionCycleId: string): Promise<DeadlinePolicy> {
    const rule = (process.env.DEADLINE_RULE ??
      'FINALIZED_COMMIT_BEFORE_DEADLINE') as DeadlineRule;
    const deadlineAt =
      process.env.DEADLINE_AT ?? new Date(Date.now() + 86_400_000).toISOString();

    return {
      policyVersion: `env-${admissionCycleId}-${deadlineAt}`,
      rule,
      deadlineAt,
      // M1 에서는 승인자가 없다. M3 에서 실제 2인 승인 기록으로 대체된다.
      approvedBy: ['UNAPPROVED', 'UNAPPROVED'],
      activatedAt: new Date(0).toISOString(),
    };
  }
}

@Module({
  providers: [
    DeadlineService,
    { provide: DeadlinePolicyPort, useClass: EnvDeadlinePolicy },
  ],
  exports: [DeadlineService],
})
export class DeadlineModule {}
