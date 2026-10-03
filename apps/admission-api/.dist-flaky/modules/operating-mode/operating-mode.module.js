"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperatingModeModule = void 0;
const common_1 = require("@nestjs/common");
const central_health_gate_1 = require("./central-health.gate");
const operating_mode_controller_1 = require("./operating-mode.controller");
/** Autonomous Mode 판단과 안내. (v1.1 §01 A1·C3, T-M3-06) */
let OperatingModeModule = class OperatingModeModule {
};
exports.OperatingModeModule = OperatingModeModule;
exports.OperatingModeModule = OperatingModeModule = __decorate([
    (0, common_1.Module)({
        controllers: [operating_mode_controller_1.OperatingModeController],
        providers: [central_health_gate_1.CentralHealthGate],
        exports: [central_health_gate_1.CentralHealthGate],
    })
], OperatingModeModule);
//# sourceMappingURL=operating-mode.module.js.map