import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { DbModule } from '@wonseoro/server-kit';
import { ApplicationModule } from './modules/application/application.module';
import { AuditModule } from './modules/audit/audit.module';
import { DeadlineModule } from './modules/deadline/deadline.module';
import { DocumentModule } from './modules/document/document.module';
import { FinalizationModule } from './modules/finalization/finalization.module';
import { PaymentModule } from './modules/payment/payment.module';
import { MetaModule } from './modules/meta/meta.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot('admission-api', 'kadmission'),
    IdempotencyModule,
    AuditModule,
    DeadlineModule,
    ApplicationModule,
    DocumentModule,
    PaymentModule,
    FinalizationModule,
    MetaModule,
  ],
})
export class AppModule {}
