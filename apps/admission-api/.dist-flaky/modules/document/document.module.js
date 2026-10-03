"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentModule = void 0;
const common_1 = require("@nestjs/common");
const audit_module_1 = require("../audit/audit.module");
const config_registry_module_1 = require("../config/config-registry.module");
const document_controller_1 = require("./document.controller");
const document_scan_controller_1 = require("./document-scan.controller");
const document_service_1 = require("./document.service");
const file_inspector_1 = require("./file-inspector");
const object_storage_1 = require("./object-storage");
let DocumentModule = class DocumentModule {
};
exports.DocumentModule = DocumentModule;
exports.DocumentModule = DocumentModule = __decorate([
    (0, common_1.Module)({
        // 전형이 받는 서류 종류는 전형 설정에서 읽는다 (§A5)
        imports: [audit_module_1.AuditModule, config_registry_module_1.ConfigRegistryModule],
        controllers: [document_controller_1.DocumentController, document_scan_controller_1.DocumentScanController],
        providers: [document_service_1.DocumentService, object_storage_1.ObjectStorage, file_inspector_1.FileInspector],
        exports: [document_service_1.DocumentService],
    })
], DocumentModule);
//# sourceMappingURL=document.module.js.map