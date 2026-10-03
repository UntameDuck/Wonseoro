"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinalizationModule = void 0;
const common_1 = require("@nestjs/common");
const audit_module_1 = require("../audit/audit.module");
const config_registry_module_1 = require("../config/config-registry.module");
const deadline_module_1 = require("../deadline/deadline.module");
const payment_module_1 = require("../payment/payment.module");
const finalization_controller_1 = require("./finalization.controller");
const finalization_service_1 = require("./finalization.service");
let FinalizationModule = class FinalizationModule {
};
exports.FinalizationModule = FinalizationModule;
exports.FinalizationModule = FinalizationModule = __decorate([
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule, config_registry_module_1.ConfigRegistryModule, deadline_module_1.DeadlineModule, payment_module_1.PaymentModule],
        controllers: [finalization_controller_1.FinalizationController],
        providers: [finalization_service_1.FinalizationService],
        exports: [finalization_service_1.FinalizationService],
    })
], FinalizationModule);
//# sourceMappingURL=finalization.module.js.map