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
var AdminGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const node_crypto_1 = require("node:crypto");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const problem_exception_1 = require("../problem/problem.exception");
const admin_scope_1 = require("./admin-scope");
/**
 * 운영 API 문지기 — 기술설계서 v1.1 §06, §09 (Elevation of Privilege), STRIDE E-03
 *
 * `/admin/v1` 뒤에는 마감시각 변경, 설정 활성화, 지원자 PII 열람, 불일치 해소가 있다.
 *
 * AUTH_MODE=oidc (T-M5-02·10)
 *   신원은 앞단 훅(oidc-auth.ts)이 담당자 렐름 토큰으로 이미 확인했다. 여기서는 경로마다
 *   ① 계약 범위(@AdminScope)에 맞는 역할이 있는가 ② 비밀번호+OTP 로 로그인했는가(acr)
 *   ③ 민감 동작(@StepUp)이면 방금 직접 인증했는가(auth_time) 를 본다. 범위가 안 붙은 경로는 닫는다.
 *
 * 그 밖의 모드(개발·gateway)
 *   `ADMIN_API_TOKEN` 공유 비밀 — 누가 했는지 구분하지 못하는 임시 문이다. 운영에서 값이 없으면 기동하지 않는다.
 *   감사에는 `x-admin-id` 를 남긴다.
 */
let AdminGuard = AdminGuard_1 = class AdminGuard {
    reflector;
    logger = new common_1.Logger(AdminGuard_1.name);
    constructor(reflector = new core_1.Reflector()) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        if (config_1.AUTH_MODE === 'oidc')
            return this.oidc(context, req);
        if (!config_1.ADMIN_API_TOKEN) {
            // 운영이면 여기 오기 전에 기동이 막힌다. 개발에서만 지나간다.
            if ((0, server_kit_1.isProduction)())
                throw problem_exception_1.ProblemException.forbidden('운영 API 가 구성되지 않았습니다.');
            return true;
        }
        const header = req.headers.authorization;
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
            throw problem_exception_1.ProblemException.forbidden('운영 API 접근 권한이 없습니다.');
        }
        if (!constantTimeEquals(header.slice('Bearer '.length), config_1.ADMIN_API_TOKEN)) {
            // 어떤 경로가 어디서 두드려졌는지는 남긴다. 토큰 값은 남기지 않는다.
            this.logger.warn(`admin token mismatch: ${req.method} ${req.url} from ${req.ip}`);
            throw problem_exception_1.ProblemException.forbidden('운영 API 접근 권한이 없습니다.');
        }
        return true;
    }
    oidc(context, req) {
        const identity = req.identity;
        // 훅이 담당자 토큰을 확인하지 못했으면 여기 오지 않는다. 와도 열지 않는다
        if (identity?.kind !== 'staff')
            throw problem_exception_1.ProblemException.unauthenticated();
        const targets = [context.getHandler(), context.getClass()];
        const scope = this.reflector.getAllAndOverride(admin_scope_1.ADMIN_SCOPE_KEY, targets);
        if (!scope) {
            this.logger.error(`권한 범위가 없는 운영 경로를 닫음: ${req.method} ${req.routeOptions?.url}`);
            throw problem_exception_1.ProblemException.forbidden('이 작업을 할 권한이 없습니다.');
        }
        const allowed = admin_scope_1.SCOPE_ROLES[scope];
        if (!identity.roles.some((r) => allowed.includes(r))) {
            // 누가 어느 경로를 두드렸는지 남긴다 — 수직 권한 상승 시도 탐지(STRIDE E-03)
            this.logger.warn(`역할 부족: ${identity.adminId} [${identity.roles.join(',')}] → ${req.method} ${req.routeOptions?.url} (필요: ${scope})`);
            throw problem_exception_1.ProblemException.forbidden('이 작업을 할 권한이 없습니다.');
        }
        const policy = config_1.OIDC;
        if (identity.acr !== policy.staffAcr)
            throw problem_exception_1.ProblemException.stepUpRequired(policy.staffAcr);
        if (this.reflector.getAllAndOverride(admin_scope_1.STEP_UP_KEY, targets)) {
            const age = identity.authTime === null ? Infinity : Date.now() / 1000 - identity.authTime;
            if (age > policy.stepUpMaxAgeSec)
                throw problem_exception_1.ProblemException.stepUpRequired(policy.staffAcr, policy.stepUpMaxAgeSec);
        }
        return true;
    }
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = AdminGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], AdminGuard);
/**
 * 길이가 다르면 비교 자체가 불가능하므로 먼저 걸러낸다.
 * 길이는 비밀이 아니고, 내용 비교는 시간이 일정해야 한다.
 */
function constantTimeEquals(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(left, right);
}
//# sourceMappingURL=admin.guard.js.map