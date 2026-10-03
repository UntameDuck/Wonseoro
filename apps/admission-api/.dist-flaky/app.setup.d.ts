import type { NestFastifyApplication } from '@nestjs/platform-fastify';
/**
 * HTTP 계층 조립 — 본문 파서·인증·요청 한도·오류 형식·멱등성·CORS.
 *
 * main.ts 와 HTTP 수준 시험(oidc-auth.integration.test.ts)이 **같은 조립**을 쓴다. 시험이 따로 조립하면
 * 훅 순서(인증 → 한도)가 운영과 달라져도 시험은 통과한다.
 */
export declare function configureHttpApp(app: NestFastifyApplication): void;
