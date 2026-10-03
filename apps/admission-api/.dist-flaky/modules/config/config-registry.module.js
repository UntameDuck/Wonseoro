"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigRegistryModule = void 0;
const common_1 = require("@nestjs/common");
const admin_controller_1 = require("./admin.controller");
const config_version_service_1 = require("./config-version.service");
const form_schema_controller_1 = require("./form-schema.controller");
const form_schema_service_1 = require("./form-schema.service");
const deadline_module_1 = require("../deadline/deadline.module");
const deadline_policy_repository_1 = require("../deadline/deadline-policy.repository");
/**
 * 전형 Config / 추가문항 Schema Registry.
 * 버전 승인(2인 + Diff 확인)·예약 활성화·Rollback·Freeze. (T-M3-02)
 */
let ConfigRegistryModule = class ConfigRegistryModule {
};
exports.ConfigRegistryModule = ConfigRegistryModule;
exports.ConfigRegistryModule = ConfigRegistryModule = __decorate([
    (0, common_1.Module)({
        // 마감 임박 구간 잠금(Freeze)이 활성 마감정책을 근거로 판정한다. (§A14)
        imports: [deadline_module_1.DeadlineModule],
        controllers: [form_schema_controller_1.FormSchemaController, admin_controller_1.AdminController],
        providers: [form_schema_service_1.FormSchemaService, config_version_service_1.ConfigVersionService, deadline_policy_repository_1.DeadlinePolicyRepository],
        exports: [form_schema_service_1.FormSchemaService, config_version_service_1.ConfigVersionService, deadline_policy_repository_1.DeadlinePolicyRepository],
    })
], ConfigRegistryModule);
//# sourceMappingURL=config-registry.module.js.map