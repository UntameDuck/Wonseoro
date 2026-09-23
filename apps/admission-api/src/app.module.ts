import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { IdentityModule } from './common/identity/identity.module';
import { DbModule } from '@wonseoro/server-kit';
import { ApplicationModule } from './modules/application/application.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DeadlineModule } from './modules/deadline/deadline.module';
import { DocumentModule } from './modules/document/document.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { FinalizationModule } from './modules/finalization/finalization.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { MetaModule } from './modules/meta/meta.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot('admission-api', 'kadmission'),
    IdempotencyModule,
    IdentityModule,
    AuditModule,
    DeadlineModule,
    ApplicationModule,
    CatalogModule,
    DocumentModule,
    EvidenceModule,
    PaymentModule,
    FinalizationModule,
    ReconciliationModule,
    MetaModule,
  ],
})
export class AppModule {}
