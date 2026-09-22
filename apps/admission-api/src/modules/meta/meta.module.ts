import { Module } from '@nestjs/common';
import { DeadlineModule } from '../deadline/deadline.module';
import { HealthController } from './health.controller';
import { MetaController } from './meta.controller';

@Module({
  imports: [DeadlineModule],
  controllers: [MetaController, HealthController],
})
export class MetaModule {}
