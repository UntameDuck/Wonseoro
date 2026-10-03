import type { FastifyRequest } from 'fastify';
/**
 * 호출자 신원 — 기술설계서 v1.1 §06, T-M5-02
 *
 * 지금은 인증 게이트웨이가 없다. 그래서 **신원을 어디서 얻는지를 설정으로 못 박고**,
 * 개발용 경로가 운영에 섞여 들어가지 못하게 한다. (config.ts AUTH_MODE)
 *
 *   dev-headers — 헤더를 그대로 믿는다. 누구나 남을 사칭할 수 있다. 개발 전용
 *   gateway     — 앞단 게이트웨이가 검증해 넣어준 값만 받는다
 *   oidc        — 이 API 가 토큰을 검증해 붙인 `request.identity` 만 본다(oidc-auth.ts). 헤더는 읽지 않는다
 *
 * 이 파일을 한 곳에 둔 이유는, 전에는 컨트롤러 네 곳이 각자 헤더를 읽고 있었기 때문이다.
 * 인증을 붙일 때 고쳐야 할 자리가 넷이면 하나는 빠뜨린다.
 */
export interface ApplicantIdentity {
    applicantId: string;
    subjectToken?: string;
}
export interface AdminIdentity {
    adminId: string;
}
export declare function applicantFrom(req: FastifyRequest): ApplicantIdentity;
export declare function adminFrom(req: FastifyRequest): AdminIdentity;
