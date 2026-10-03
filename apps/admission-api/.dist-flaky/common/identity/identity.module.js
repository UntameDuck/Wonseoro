"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../config");
const oidc_auth_1 = require("./oidc-auth");
const ownership_service_1 = require("./ownership.service");
/** oidc 모드에서만 토큰 검증기를 만든다 — 다른 모드에서는 발급자 설정이 없다 */
const oidcProviders = config_1.AUTH_MODE === 'oidc' ? [oidc_auth_1.ApplicantDirectory, oidc_auth_1.OidcAuthenticator] : [];
/**
 * 소유권 확인은 거의 모든 모듈이 쓴다.
 * 모듈마다 provider 를 다시 선언하게 하면 한 곳이 빠졌을 때 그 경로만 조용히 뚫린다.
 */
let IdentityModule = class IdentityModule {
};
exports.IdentityModule = IdentityModule;
exports.IdentityModule = IdentityModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({ providers: [ownership_service_1.Ownership, ...oidcProviders], exports: [ownership_service_1.Ownership, ...oidcProviders] })
], IdentityModule);
//# sourceMappingURL=identity.module.js.map