import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentController } from './payment.controller';
import { MockPaymentProvider, PaymentProviderPort } from './payment.provider';
import { PaymentRecheckWorker } from './payment-recheck.worker';
import { PaymentService } from './payment.service';

/**
 * 실 PG 는 M6 에서 이 Provider 만 교체한다. (T-M6-04)
 * 대학마다 계약 PG 가 다르므로 대학별 values 로 고르게 된다.
 */
@Module({
  imports: [AuditModule],
  controllers: [PaymentController, PaymentCallbackController],
  providers: [
    PaymentService,
    PaymentRecheckWorker,
    { provide: PaymentProviderPort, useClass: MockPaymentProvider },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
