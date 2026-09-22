import { Module } from '@nestjs/common';
import { DeadlineMode, DeadlinePolicy } from '@wonseoro/contracts';
import { DeadlinePolicyPort } from './deadline-policy.port';
import { DeadlineService } from './deadline.service';

/**
 * M1 임시 구현 — 환경변수에서 마감 정책을 읽는다.
 *
 * M3 에서 deadline_policy 테이블 + 서명된 정책 버전 + 입학처 2인 승인 엔진으로
 * 교체한다. (T-M3-01) 그때 이 Provider 만 바꾸면 되고 호출부는 그대로다.
 */
class EnvDeadlinePolicy extends DeadlinePolicyPort {
  async current(admissionCycleId: string): Promise<DeadlinePolicy> {
    const mode = (process.env.DEADLINE_MODE ??
      'FINALIZED_COMMIT_BEFORE_DEADLINE') as DeadlineMode;
    const deadlineAt =
      process.env.DEADLINE_AT ?? new Date(Date.now() + 86_400_000).toISOString();

    return {
      version: `env-${admissionCycleId}-${deadlineAt}`,
      mode,
      deadlineAt,
      // M1 에는 승인자가 없다. M3 에서 실제 2인 승인 기록으로 대체된다.
      // DDL CHECK (approved_by_1 <> approved_by_2) 를 지키기 위해 서로 다른 값을 쓴다.
      approvedBy1: 'UNAPPROVED-1',
      approvedBy2: 'UNAPPROVED-2',
      approvedAt: new Date(0).toISOString(),
      activatedAt: new Date(0).toISOString(),
      policyHash: 'dev-only',
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
