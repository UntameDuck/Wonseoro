"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaModule = void 0;
const common_1 = require("@nestjs/common");
const deadline_module_1 = require("../deadline/deadline.module");
const health_controller_1 = require("./health.controller");
const meta_controller_1 = require("./meta.controller");
const self_check_controller_1 = require("./self-check.controller");
let MetaModule = class MetaModule {
};
exports.MetaModule = MetaModule;
exports.MetaModule = MetaModule = __decorate([
    (0, common_1.Module)({
        imports: [deadline_module_1.DeadlineModule],
        controllers: [meta_controller_1.MetaController, health_controller_1.HealthController, self_check_controller_1.SelfCheckController],
    })
], MetaModule);
//# sourceMappingURL=meta.module.js.map