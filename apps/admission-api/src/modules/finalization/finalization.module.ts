import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConfigRegistryModule } from '../config/config-registry.module';
import { DeadlineModule } from '../deadline/deadline.module';
import { PaymentModule } from '../payment/payment.module';
import { FinalizationController } from './finalization.controller';
import { FinalizationService } from './finalization.service';

@Module({
  imports: [AuditModule, ConfigRegistryModule, DeadlineModule, PaymentModule],
  controllers: [FinalizationController],
  providers: [FinalizationService],
  exports: [FinalizationService],
})
export class FinalizationModule {}
