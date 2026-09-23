import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ConfigVersionService } from './config-version.service';
import { FormSchemaController } from './form-schema.controller';
import { FormSchemaService } from './form-schema.service';
import { DeadlineModule } from '../deadline/deadline.module';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';

/**
 * 전형 Config / 추가문항 Schema Registry.
 * 버전 승인(2인 + Diff 확인)·예약 활성화·Rollback·Freeze. (T-M3-02)
 */
@Module({
  // 마감 임박 구간 잠금(Freeze)이 활성 마감정책을 근거로 판정한다. (§A14)
  imports: [DeadlineModule],
  controllers: [FormSchemaController, AdminController],
  providers: [FormSchemaService, ConfigVersionService, DeadlinePolicyRepository],
  exports: [FormSchemaService, ConfigVersionService, DeadlinePolicyRepository],
})
export class ConfigRegistryModule {}
