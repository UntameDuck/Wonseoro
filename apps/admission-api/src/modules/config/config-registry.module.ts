import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ConfigVersionService } from './config-version.service';
import { FormSchemaController } from './form-schema.controller';
import { FormSchemaService } from './form-schema.service';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';

/**
 * 전형 Config / 추가문항 Schema Registry.
 * M3 에서 버전 승인·예약 활성화·rollback 이 여기에 붙는다. (T-M3-02)
 */
@Module({
  controllers: [FormSchemaController, AdminController],
  providers: [FormSchemaService, ConfigVersionService, DeadlinePolicyRepository],
  exports: [FormSchemaService, ConfigVersionService, DeadlinePolicyRepository],
})
export class ConfigRegistryModule {}
