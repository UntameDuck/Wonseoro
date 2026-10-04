import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { OutboxArchiveModule } from './common/outbox/outbox-archive';
import { AuditWormModule } from './modules/audit/audit-worm';
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
import { IncidentModule } from './modules/incident/incident.module';
import { SupportModule } from './modules/support/support.module';
import { PrivacyRequestModule } from './modules/privacy/privacy-request.module';
import { FeeRefundModule } from './modules/refund/fee-refund.module';
import { AccessGrantModule } from './modules/access-grant/access-grant.module';
import { BusinessGauges } from './common/telemetry/business-gauges';
import { ClockMonitor } from './common/time/server-clock';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot('admission-api', 'kadmission'),
    ResilienceModule,
    IdempotencyModule,
    OutboxArchiveModule,
    AuditWormModule,
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
    IncidentModule,
    SupportModule,
    PrivacyRequestModule,
    FeeRefundModule,
    AccessGrantModule,
  ],
  // 업무 KPI 게이지 — Outbox·중앙 반영·서류 검사 대기·잠금 대기 (T-M4-22·23)
  // 서버 시각 측정 — 노드 시계와 DB 시계의 차이를 계속 잰다 (§A9)
  providers: [BusinessGauges, ClockMonitor],
})
export class AppModule {}
