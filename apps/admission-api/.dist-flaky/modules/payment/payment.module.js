"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentModule = void 0;
const common_1 = require("@nestjs/common");
const audit_module_1 = require("../audit/audit.module");
const payment_callback_controller_1 = require("./payment-callback.controller");
const payment_controller_1 = require("./payment.controller");
const payment_provider_1 = require("./payment.provider");
const payment_recheck_worker_1 = require("./payment-recheck.worker");
const payment_service_1 = require("./payment.service");
/**
 * 실 PG 는 이 Provider 만 교체한다 (T-M6-04 실 PG Sandbox — PG 사 계약이 필요하다).
 * 대학마다 계약 PG 가 다르므로 대학별 values 로 고르게 된다. 운영에서 Mock 은 기동이 막힌다 (R8).
 */
let PaymentModule = class PaymentModule {
};
exports.PaymentModule = PaymentModule;
exports.PaymentModule = PaymentModule = __decorate([
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule],
        controllers: [payment_controller_1.PaymentController, payment_callback_controller_1.PaymentCallbackController],
        providers: [
            payment_service_1.PaymentService,
            payment_recheck_worker_1.PaymentRecheckWorker,
            { provide: payment_provider_1.PaymentProviderPort, useClass: payment_provider_1.MockPaymentProvider },
        ],
        // 대조가 PG 정산 목록을 읽는다 (ReconciliationService 9번)
        exports: [payment_service_1.PaymentService, payment_provider_1.PaymentProviderPort],
    })
], PaymentModule);
//# sourceMappingURL=payment.module.js.map