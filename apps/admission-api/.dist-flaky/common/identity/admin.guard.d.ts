import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
export declare class AdminGuard implements CanActivate {
    private readonly reflector;
    private readonly logger;
    constructor(reflector?: Reflector);
    canActivate(context: ExecutionContext): boolean;
    private oidc;
}
