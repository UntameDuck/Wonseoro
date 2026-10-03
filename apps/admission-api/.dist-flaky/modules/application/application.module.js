"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationModule = void 0;
const common_1 = require("@nestjs/common");
const audit_module_1 = require("../audit/audit.module");
const config_registry_module_1 = require("../config/config-registry.module");
const deadline_module_1 = require("../deadline/deadline.module");
const application_state_service_1 = require("./application-state.service");
const application_controller_1 = require("./application.controller");
const application_repository_1 = require("./application.repository");
const profile_vault_client_1 = require("./profile-vault.client");
let ApplicationModule = class ApplicationModule {
};
exports.ApplicationModule = ApplicationModule;
exports.ApplicationModule = ApplicationModule = __decorate([
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule, config_registry_module_1.ConfigRegistryModule, deadline_module_1.DeadlineModule],
        controllers: [application_controller_1.ApplicationController],
        providers: [application_state_service_1.ApplicationStateService, application_repository_1.ApplicationRepository, profile_vault_client_1.ProfileVaultClient],
        exports: [application_state_service_1.ApplicationStateService, application_repository_1.ApplicationRepository],
    })
], ApplicationModule);
//# sourceMappingURL=application.module.js.map