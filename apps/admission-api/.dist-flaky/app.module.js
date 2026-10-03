"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const idempotency_module_1 = require("./common/idempotency/idempotency.module");
const outbox_archive_1 = require("./common/outbox/outbox-archive");
const audit_worm_1 = require("./modules/audit/audit-worm");
const identity_module_1 = require("./common/identity/identity.module");
const dependency_breakers_1 = require("./common/resilience/dependency-breakers");
const server_kit_1 = require("@wonseoro/server-kit");
const activation_module_1 = require("./modules/activation/activation.module");
const application_module_1 = require("./modules/application/application.module");
const audit_module_1 = require("./modules/audit/audit.module");
const cancellation_module_1 = require("./modules/cancellation/cancellation.module");
const catalog_module_1 = require("./modules/catalog/catalog.module");
const deadline_module_1 = require("./modules/deadline/deadline.module");
const document_module_1 = require("./modules/document/document.module");
const evidence_module_1 = require("./modules/evidence/evidence.module");
const finalization_module_1 = require("./modules/finalization/finalization.module");
const payment_module_1 = require("./modules/payment/payment.module");
const reconciliation_module_1 = require("./modules/reconciliation/reconciliation.module");
const retention_module_1 = require("./modules/retention/retention.module");
const meta_module_1 = require("./modules/meta/meta.module");
const operating_mode_module_1 = require("./modules/operating-mode/operating-mode.module");
const business_gauges_1 = require("./common/telemetry/business-gauges");
const server_clock_1 = require("./common/time/server-clock");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            server_kit_1.DbModule.forRoot('admission-api', 'kadmission'),
            dependency_breakers_1.ResilienceModule,
            idempotency_module_1.IdempotencyModule,
            outbox_archive_1.OutboxArchiveModule,
            audit_worm_1.AuditWormModule,
            identity_module_1.IdentityModule,
            audit_module_1.AuditModule,
            activation_module_1.ActivationModule,
            deadline_module_1.DeadlineModule,
            application_module_1.ApplicationModule,
            cancellation_module_1.CancellationModule,
            catalog_module_1.CatalogModule,
            document_module_1.DocumentModule,
            evidence_module_1.EvidenceModule,
            payment_module_1.PaymentModule,
            finalization_module_1.FinalizationModule,
            reconciliation_module_1.ReconciliationModule,
            retention_module_1.RetentionModule,
            meta_module_1.MetaModule,
            operating_mode_module_1.OperatingModeModule,
        ],
        // 업무 KPI 게이지 — Outbox·중앙 반영·서류 검사 대기·잠금 대기 (T-M4-22·23)
        // 서버 시각 측정 — 노드 시계와 DB 시계의 차이를 계속 잰다 (§A9)
        providers: [business_gauges_1.BusinessGauges, server_clock_1.ClockMonitor],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map