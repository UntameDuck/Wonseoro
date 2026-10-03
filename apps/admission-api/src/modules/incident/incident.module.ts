import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IncidentController, PublicServiceStatusController } from './incident.controller';
import { IncidentService } from './incident.service';

@Module({
  imports: [AuditModule],
  controllers: [PublicServiceStatusController, IncidentController],
  providers: [IncidentService],
  exports: [IncidentService],
})
export class IncidentModule {}
