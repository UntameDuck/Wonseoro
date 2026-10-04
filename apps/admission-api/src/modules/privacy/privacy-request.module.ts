import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrivacyRequestAdminController, PrivacyRequestController } from './privacy-request.controller';
import { PrivacyRequestService } from './privacy-request.service';

@Module({
  imports: [AuditModule],
  controllers: [PrivacyRequestController, PrivacyRequestAdminController],
  providers: [PrivacyRequestService],
})
export class PrivacyRequestModule {}
