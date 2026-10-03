import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Db, OidcVerifier } from '@wonseoro/server-kit';
/**
 * OIDC 인증 — T-M5-02·10 단계 3 (docs/12-authentication-plan.md A3·A5·A6·A9)
 *
 * 요청마다 가장 먼저(요청 한도보다 앞에서) 토큰을 검증해 `request.identity` 에 붙인다.
 * 한도·소유권·역할 검사는 모두 이 신원을 본다 — 헤더를 다시 읽지 않는다.
 *
 * 경로의 주인
 *   /admin/v1/**  담당자 렐름 토큰. 역할·인증 수준·재인증은 AdminGuard 가 경로마다 본다
 *   /api/v1/**    지원자 렐름 토큰. 계약에서 `security: []` 인 경로(시각·운영 상태·공개키·PG 콜백)만 토큰 없이
 *   그 밖        건강 확인·내부(mTLS) — 여기서 보지 않는다
 * 계약과 이 분류가 어긋나면 `oidc-routes.test.ts` 가 깨진다.
 */
export interface StaffIdentity {
    kind: 'staff';
    /** 감사·2인 승인에 남는 담당자 이름 — 발급자의 사용자 이름(바뀌지 않게 운영), 없으면 sub */
    adminId: string;
    subject: string;
    roles: string[];
    acr: string | null;
    /** 직접 인증한 시각(초) */
    authTime: number | null;
}
export interface ApplicantOidcIdentity {
    kind: 'applicant';
    applicantId: string;
    /** 지원자 렐름의 가명 주체(sub). 중앙 동기화의 지원자 토큰으로 쓴다 */
    subjectToken: string;
    /** 직접 인증한 시각(초) — 위험 차단을 본인확인 다시 하기로 풀 때 본다(ADR-0009) */
    authTime: number | null;
}
export type OidcIdentity = StaffIdentity | ApplicantOidcIdentity;
declare module 'fastify' {
    interface FastifyRequest {
        identity?: OidcIdentity;
    }
}
export type RouteAudience = 'public' | 'applicant' | 'staff' | 'none';
/** 계약에서 `security: []` 인 지원자 쪽 경로. 토큰 없이 부른다 */
export declare const PUBLIC_ROUTES: ReadonlySet<string>;
/** 경로 모양(`/api/v1/applications/:applicationId`)으로 누구의 토큰이 필요한지 */
export declare function routeAudience(method: string, routeUrl: string | undefined): RouteAudience;
/**
 * 지원자 렐름의 주체(sub) → 원서로 지원자 식별자. 처음 오면 만든다 (A9).
 * 실명·주민번호 같은 개인정보는 여기서 받지 않는다 — `pii_ciphertext` 는 비워 두고(`pii_key_version='none'`)
 * 본인확인 기관 연동·필드 암호화(T-M5-06) 때 채운다 (docs/10 G-7).
 */
export declare class ApplicantDirectory {
    private readonly db;
    private readonly cache;
    constructor(db: Db);
    resolve(subject: string): Promise<string>;
}
export declare class OidcAuthenticator {
    private readonly applicants;
    private readonly logger;
    readonly applicant: OidcVerifier;
    readonly staff: OidcVerifier;
    private lastGraceLog;
    constructor(applicants: ApplicantDirectory);
    /** 경로에 맞는 토큰을 검증해 신원을 돌려준다. 토큰이 필요 없는 경로면 null */
    authenticate(request: FastifyRequest): Promise<OidcIdentity | null>;
    private applicantOf;
}
/**
 * Fastify 에 건다 — 요청 한도(throttle) 훅보다 **먼저** 걸어야 한다. 한도는 인증된 지원자 기준이다.
 * Nest 예외 필터 밖이라 오류 응답을 여기서 problem+json 으로 직접 쓴다.
 */
export declare function installOidcAuthentication(fastify: FastifyInstance, authenticator: OidcAuthenticator): void;
