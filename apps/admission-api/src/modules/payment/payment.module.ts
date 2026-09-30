import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentController } from './payment.controller';
import { MockPaymentProvider, PaymentProviderPort } from './payment.provider';
import { PaymentRecheckWorker } from './payment-recheck.worker';
import { PaymentService } from './payment.service';

/**
 * 실 PG 는 이 Provider 만 교체한다 (T-M6-04 실 PG Sandbox — PG 사 계약이 필요하다).
 * 대학마다 계약 PG 가 다르므로 대학별 values 로 고르게 된다. 운영에서 Mock 은 기동이 막힌다 (R8).
 */
@Module({
  imports: [AuditModule],
  controllers: [PaymentController, PaymentCallbackController],
  providers: [
    PaymentService,
    PaymentRecheckWorker,
    { provide: PaymentProviderPort, useClass: MockPaymentProvider },
  ],
  // 대조가 PG 정산 목록을 읽는다 (ReconciliationService 9번)
  exports: [PaymentService, PaymentProviderPort],
})
export class PaymentModule {}
