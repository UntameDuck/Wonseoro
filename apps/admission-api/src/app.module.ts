import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { IdentityModule } from './common/identity/identity.module';
import { ResilienceModule } from './common/resilience/dependency-breakers';
import { DbModule } from '@wonseoro/server-kit';
import { ActivationModule } from './modules/activation/activation.module';
import { ApplicationModule } from './modules/application/application.module';
import { AuditModule } from './modules/audit/audit.module';
import { CancellationModule } from './modules/cancellation/cancellation.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DeadlineModule } from './modules/deadline/deadline.module';
import { DocumentModule } from './modules/document/document.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { FinalizationModule } from './modules/finalization/finalization.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { RetentionModule } from './modules/retention/retention.module';
import { MetaModule } from './modules/meta/meta.module';
import { OperatingModeModule } from './modules/operating-mode/operating-mode.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot('admission-api', 'kadmission'),
    ResilienceModule,
    IdempotencyModule,
    IdentityModule,
    AuditModule,
    ActivationModule,
    DeadlineModule,
    ApplicationModule,
    CancellationModule,
    CatalogModule,
    DocumentModule,
    EvidenceModule,
    PaymentModule,
    FinalizationModule,
    ReconciliationModule,
    RetentionModule,
    MetaModule,
    OperatingModeModule,
  ],
})
export class AppModule {}
