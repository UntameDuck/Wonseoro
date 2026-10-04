import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeadlineModule } from '../deadline/deadline.module';
import { IncidentModule } from '../incident/incident.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuditModule, DeadlineModule, IncidentModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
