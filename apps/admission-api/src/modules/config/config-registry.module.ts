import { Module } from '@nestjs/common';
import { FormSchemaController } from './form-schema.controller';
import { FormSchemaService } from './form-schema.service';

/**
 * 전형 Config / 추가문항 Schema Registry.
 * M3 에서 버전 승인·예약 활성화·rollback 이 여기에 붙는다. (T-M3-02)
 */
@Module({
  controllers: [FormSchemaController],
  providers: [FormSchemaService],
  exports: [FormSchemaService],
})
export class ConfigRegistryModule {}
