import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FeeRefundAdminController, FeeRefundController } from './fee-refund.controller';
import { FeeRefundService } from './fee-refund.service';

@Module({
  imports: [AuditModule],
  controllers: [FeeRefundController, FeeRefundAdminController],
  providers: [FeeRefundService],
})
export class FeeRefundModule {}
