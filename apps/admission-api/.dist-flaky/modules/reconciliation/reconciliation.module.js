"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconciliationModule = void 0;
const common_1 = require("@nestjs/common");
const peak_mode_1 = require("../../common/scheduling/peak-mode");
const config_1 = require("../../config");
const audit_module_1 = require("../audit/audit.module");
const payment_module_1 = require("../payment/payment.module");
const reconciliation_controller_1 = require("./reconciliation.controller");
const reconciliation_scheduler_1 = require("./reconciliation.scheduler");
const reconciliation_service_1 = require("./reconciliation.service");
let ReconciliationModule = class ReconciliationModule {
};
exports.ReconciliationModule = ReconciliationModule;
exports.ReconciliationModule = ReconciliationModule = __decorate([
    (0, common_1.Module)({
        // PG 정산 대조 — 결제 모듈의 PG 어댑터·재확인 경로를 쓴다
        imports: [audit_module_1.AuditModule, payment_module_1.PaymentModule],
        controllers: [reconciliation_controller_1.ReconciliationController],
        providers: [
            reconciliation_service_1.ReconciliationService,
            { provide: peak_mode_1.PEAK_MODE_POLICY, useValue: config_1.PEAK_MODE },
            reconciliation_scheduler_1.ReconciliationScheduler,
        ],
        exports: [reconciliation_service_1.ReconciliationService],
    })
], ReconciliationModule);
//# sourceMappingURL=reconciliation.module.js.map