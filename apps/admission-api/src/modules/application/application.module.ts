import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeadlineModule } from '../deadline/deadline.module';
import { ApplicationStateService } from './application-state.service';
import { ApplicationController } from './application.controller';
import { ApplicationRepository } from './application.repository';

@Module({
  imports: [AuditModule, DeadlineModule],
  controllers: [ApplicationController],
  providers: [ApplicationStateService, ApplicationRepository],
  exports: [ApplicationStateService, ApplicationRepository],
})
export class ApplicationModule {}
