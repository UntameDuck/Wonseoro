"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StepUp = exports.AdminScope = exports.STEP_UP_KEY = exports.ADMIN_SCOPE_KEY = exports.SCOPE_ROLES = void 0;
const common_1 = require("@nestjs/common");
/**
 * 계약 범위 → 담당자 역할 (docs/12-authentication-plan.md A5, 노션 06 역할 정의)
 *   admin    — admission-admin: 업무 Config API(설정·마감·보존·활성화 기록)
 *   operator — admission-admin: 결제 대사도 입학처 업무다. sre-operator 는 Kubernetes 권한만 갖는다
 *   auditor  — security-auditor: 감사·증적 읽기 전용
 * platform-viewer·sre-operator·release-controller·break-glass 는 업무 API 권한이 없다.
 */
exports.SCOPE_ROLES = {
    admin: ['admission-admin'],
    operator: ['admission-admin'],
    auditor: ['security-auditor'],
};
exports.ADMIN_SCOPE_KEY = 'wonseoro:admin-scope';
exports.STEP_UP_KEY = 'wonseoro:step-up';
const AdminScope = (scope) => (0, common_1.SetMetadata)(exports.ADMIN_SCOPE_KEY, scope);
exports.AdminScope = AdminScope;
/**
 * 민감 동작 — 방금(OIDC_STEP_UP_MAX_AGE_SEC, 기본 5분) 직접 인증했어야 한다 (T-M5-10 Step-up).
 * 승인·활성화·되돌리기·마감 연장·대사 예외 해결·지원자 증적 열람.
 */
const StepUp = () => (0, common_1.SetMetadata)(exports.STEP_UP_KEY, true);
exports.StepUp = StepUp;
//# sourceMappingURL=admin-scope.js.map