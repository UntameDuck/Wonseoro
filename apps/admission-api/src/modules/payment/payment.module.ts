import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentController } from './payment.controller';
import { MockPaymentProvider, PaymentProviderPort } from './payment.provider';
import { PaymentService } from './payment.service';

/**
 * 실 PG 는 M6 에서 이 Provider 만 교체한다. (T-M6-04)
 * 대학마다 계약 PG 가 다르므로 대학별 values 로 고르게 된다.
 */
@Module({
  imports: [AuditModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    { provide: PaymentProviderPort, useClass: MockPaymentProvider },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
