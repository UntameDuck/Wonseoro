"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadlineModule = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const activation_recorder_1 = require("../activation/activation-recorder");
const deadline_policy_port_1 = require("./deadline-policy.port");
const deadline_policy_repository_1 = require("./deadline-policy.repository");
const deadline_service_1 = require("./deadline.service");
/**
 * M1 의 환경변수 구현을 DB 기반 정책 엔진으로 교체했다. (T-M3-01)
 *
 * 이제 마감 판정의 근거는 **승인·활성화 기록이 남은 정책 버전**이다.
 * 활성 정책이 없으면 판정하지 않는다 — 추측하지 않는다.
 * 개발 편의를 위한 환경변수 대체는 ALLOW_ENV_DEADLINE_POLICY=true 일 때만 열린다.
 */
let DeadlineModule = class DeadlineModule {
};
exports.DeadlineModule = DeadlineModule;
exports.DeadlineModule = DeadlineModule = __decorate([
    (0, common_1.Module)({
        providers: [
            deadline_service_1.DeadlineService,
            deadline_policy_repository_1.DeadlinePolicyRepository,
            {
                provide: deadline_policy_port_1.DeadlinePolicyPort,
                useFactory: (db, activations) => new deadline_policy_repository_1.DeadlinePolicyRepository(db, activations),
                inject: [server_kit_1.Db, activation_recorder_1.ActivationRecorder],
            },
        ],
        exports: [deadline_service_1.DeadlineService, deadline_policy_port_1.DeadlinePolicyPort],
    })
], DeadlineModule);
//# sourceMappingURL=deadline.module.js.map