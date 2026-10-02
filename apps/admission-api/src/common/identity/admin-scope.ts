import { SetMetadata } from '@nestjs/common';

/**
 * 운영 API 경로의 권한 — 계약(OpenAPI)의 `security: [{ oidc: [scope] }]` 를 코드에 그대로 옮긴다.
 * 경로마다 붙인다. 붙이지 않은 운영 경로는 AdminGuard 가 닫는다(닫힌 실패).
 * 계약과 어긋나면 `oidc-routes.test.ts` 가 깨진다.
 */
export type AdminScopeName = 'admin' | 'operator' | 'auditor';

/**
 * 계약 범위 → 담당자 역할 (docs/12-authentication-plan.md A5, 노션 06 역할 정의)
 *   admin    — admission-admin: 업무 Config API(설정·마감·보존·활성화 기록)
 *   operator — admission-admin: 결제 대사도 입학처 업무다. sre-operator 는 Kubernetes 권한만 갖는다
 *   auditor  — security-auditor: 감사·증적 읽기 전용
 * platform-viewer·sre-operator·release-controller·break-glass 는 업무 API 권한이 없다.
 */
export const SCOPE_ROLES: Readonly<Record<AdminScopeName, readonly string[]>> = {
  admin: ['admission-admin'],
  operator: ['admission-admin'],
  auditor: ['security-auditor'],
};

export const ADMIN_SCOPE_KEY = 'wonseoro:admin-scope';
export const STEP_UP_KEY = 'wonseoro:step-up';

export const AdminScope = (scope: AdminScopeName) => SetMetadata(ADMIN_SCOPE_KEY, scope);

/**
 * 민감 동작 — 방금(OIDC_STEP_UP_MAX_AGE_SEC, 기본 5분) 직접 인증했어야 한다 (T-M5-10 Step-up).
 * 승인·활성화·되돌리기·마감 연장·대사 예외 해결·지원자 증적 열람.
 */
export const StepUp = () => SetMetadata(STEP_UP_KEY, true);
