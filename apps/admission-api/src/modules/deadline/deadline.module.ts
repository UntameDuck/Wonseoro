import { Module } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ActivationRecorder } from '../activation/activation-recorder';
import { DeadlinePolicyPort } from './deadline-policy.port';
import { DeadlinePolicyRepository } from './deadline-policy.repository';
import { DeadlineService } from './deadline.service';

/**
 * M1 의 환경변수 구현을 DB 기반 정책 엔진으로 교체했다. (T-M3-01)
 *
 * 이제 마감 판정의 근거는 **승인·활성화 기록이 남은 정책 버전**이다.
 * 활성 정책이 없으면 판정하지 않는다 — 추측하지 않는다.
 * 개발 편의를 위한 환경변수 대체는 ALLOW_ENV_DEADLINE_POLICY=true 일 때만 열린다.
 */
@Module({
  providers: [
    DeadlineService,
    DeadlinePolicyRepository,
    {
      provide: DeadlinePolicyPort,
      useFactory: (db: Db, activations: ActivationRecorder) =>
        new DeadlinePolicyRepository(db, activations),
      inject: [Db, ActivationRecorder],
    },
  ],
  exports: [DeadlineService, DeadlinePolicyPort],
})
export class DeadlineModule {}
