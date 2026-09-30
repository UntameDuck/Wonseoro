import { Module } from '@nestjs/common';
import { PEAK_MODE_POLICY } from '../../common/scheduling/peak-mode';
import { PEAK_MODE } from '../../config';
import { AuditModule } from '../audit/audit.module';
import { PaymentModule } from '../payment/payment.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { ReconciliationService } from './reconciliation.service';

@Module({
  // PG 정산 대조 — 결제 모듈의 PG 어댑터·재확인 경로를 쓴다
  imports: [AuditModule, PaymentModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    { provide: PEAK_MODE_POLICY, useValue: PEAK_MODE },
    ReconciliationScheduler,
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
