import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { ApplicationModule } from './modules/application/application.module';
import { DeadlineModule } from './modules/deadline/deadline.module';
import { MetaModule } from './modules/meta/meta.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    IdempotencyModule,
    DeadlineModule,
    ApplicationModule,
    MetaModule,
  ],
})
export class AppModule {}
