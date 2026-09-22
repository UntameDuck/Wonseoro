import { Module } from '@nestjs/common';
import { DeadlineModule } from '../deadline/deadline.module';
import { HealthController } from './health.controller';
import { MetaController } from './meta.controller';
import { SelfCheckController } from './self-check.controller';

@Module({
  imports: [DeadlineModule],
  controllers: [MetaController, HealthController, SelfCheckController],
})
export class MetaModule {}
