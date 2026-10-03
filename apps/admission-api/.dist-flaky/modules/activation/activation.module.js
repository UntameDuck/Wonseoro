"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivationModule = exports.SigningKeysController = void 0;
const common_1 = require("@nestjs/common");
const audit_module_1 = require("../audit/audit.module");
const activation_recorder_1 = require("./activation-recorder");
const activation_signer_1 = require("./activation-signer");
/**
 * GET /api/v1/meta/signing-keys — 활성화 기록 검증용 공개키.
 *
 * 누구나 가져갈 수 있다. 공개키로는 서명을 만들 수 없고 확인만 할 수 있다.
 * 중앙이 끊겨도 이 대학이 적용한 마감 정책이 승인된 그대로인지,
 * 이 키와 활성화 기록만으로 대학 밖에서 확인할 수 있다. (§A1)
 *
 * 계약에 없는 경로다. (D-35)
 */
let SigningKeysController = class SigningKeysController {
    signer;
    constructor(signer) {
        this.signer = signer;
    }
    keys() {
        return { keys: this.signer.publicKeys() };
    }
};
exports.SigningKeysController = SigningKeysController;
__decorate([
    (0, common_1.Get)('signing-keys'),
    (0, common_1.Header)('cache-control', 'public, max-age=300'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SigningKeysController.prototype, "keys", null);
exports.SigningKeysController = SigningKeysController = __decorate([
    (0, common_1.Controller)('api/v1/meta'),
    __metadata("design:paramtypes", [activation_signer_1.ActivationSigner])
], SigningKeysController);
/** 서명된 활성화 기록. 마감 정책·설정 양쪽이 쓰므로 전역으로 둔다. (T-M3-14·15) */
let ActivationModule = class ActivationModule {
};
exports.ActivationModule = ActivationModule;
exports.ActivationModule = ActivationModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [audit_module_1.AuditModule],
        controllers: [SigningKeysController],
        providers: [activation_signer_1.ActivationSigner, activation_recorder_1.ActivationRecorder],
        exports: [activation_signer_1.ActivationSigner, activation_recorder_1.ActivationRecorder],
    })
], ActivationModule);
//# sourceMappingURL=activation.module.js.map