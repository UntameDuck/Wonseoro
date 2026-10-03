import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM, ProblemCode, problemType } from '@wonseoro/contracts';
import { egressHttp, OidcTokenError, OidcUnavailableError, OidcVerifier } from '@wonseoro/server-kit';
import { OIDC } from './config';

/**
 * OIDC 인증 — 중앙 API (T-M5-02 단계 4, docs/12-authentication-plan.md)
 *
 * 중앙의 지원자 API 는 "내 원서"·공통원서 둘이다(`/api/v1/**`, 계약에서 둘 다 전역 oidc). 대학 API 와 같은
 * 지원자 렐름 토큰을 받고, **토큰의 주체(sub)를 가명 토큰으로 쓴다** — 대학이 같은 sub 로 "내 원서" 참조를 만들고
 * 공통원서 Snapshot 을 요청하므로 둘이 이어진다. 대상(aud)은 `wonseoro-central-api` 다.
 * 내부 경로(`/internal/**`, 대학 → 중앙)는 mTLS 몫이라 여기서 보지 않는다(T-M5-05).
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** 검증된 지원자 토큰의 주체 — oidc 모드에서만 */
    applicantSubject?: string;
  }
}

/** 경로 모양으로 지원자 토큰이 필요한지 */
export function needsApplicantToken(method: string, routeUrl: string | undefined): boolean {
  return !!routeUrl && method !== 'OPTIONS' && routeUrl.startsWith('/api/v1/');
}

export function createApplicantVerifier(): OidcVerifier {
  if (!OIDC) throw new Error('AUTH_MODE=oidc 가 아닌데 검증기를 만들었다');
  return new OidcVerifier({
    issuer: OIDC.applicantIssuer,
    audience: OIDC.audience,
    maxStaleMs: OIDC.jwksMaxStaleMs,
    snapshotFile: OIDC.jwksSnapshotDir ? join(OIDC.jwksSnapshotDir, 'jwks-applicant.json') : undefined,
    outageGraceMs: OIDC.applicantOutageGraceMs,
    // 공개키 조회도 출구 허용 목록을 거친다 (T-M5-07)
    fetch: ((url: string | URL, init?: RequestInit) => egressHttp().fetch(String(url), init)) as typeof globalThis.fetch,
  });
}

function traceIdOf(request: FastifyRequest): string {
  const tp = request.headers.traceparent;
  if (typeof tp === 'string') {
    const parts = tp.split('-');
    if (parts[1]) return parts[1];
  }
  return request.id ?? '';
}

/** 요청마다 가장 먼저 — 토큰을 검증해 `request.applicantSubject` 에 붙인다. 오류는 problem+json 으로 직접 쓴다 */
export function installOidcAuthentication(fastify: FastifyInstance, verifier: OidcVerifier): void {
  const logger = new Logger('auth');
  let lastGraceLog = 0;
  fastify.decorateRequest('applicantSubject', undefined);
  fastify.addHook('onRequest', async (request, reply) => {
    if (!needsApplicantToken(request.method, request.routeOptions?.url)) return;
    try {
      const verified = await verifier.verify(OidcVerifier.bearer(request.headers.authorization));
      request.applicantSubject = verified.subject;
      if (verified.outageGrace && Date.now() - lastGraceLog > 60_000) {
        lastGraceLog = Date.now();
        logger.warn('발급자에 닿지 않아 만료된 지원자 토큰을 단절 유예로 받는 중 (D-67)');
      }
    } catch (err) {
      let status: number;
      let code: string;
      let title: string;
      let detail: string;
      if (err instanceof OidcUnavailableError) {
        logger.error(`발급자 키를 쓸 수 없어 지원자 토큰을 판단하지 못함: ${err.message}`);
        [status, code, title, detail] = [503, ProblemCode.AUTH_UNAVAILABLE, '지금 로그인을 확인할 수 없습니다', '잠시 후 다시 시도해 주십시오.'];
        reply.header('retry-after', '30');
      } else if (err instanceof OidcTokenError) {
        if (err.problem !== 'missing') logger.warn(`지원자 토큰 거절: ${err.problem}`);
        [status, code, title, detail] = [401, ProblemCode.UNAUTHENTICATED, '로그인이 필요합니다', '로그인 정보가 없거나 확인되지 않았습니다. 다시 로그인해 주십시오.'];
        reply.header('www-authenticate', 'Bearer error="invalid_token"');
      } else {
        throw err;
      }
      return reply
        .status(status)
        .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
        .header('cache-control', CACHE_CONTROL_PII)
        .send({ type: problemType(code as never), title, status, code, detail, instance: request.url, traceId: traceIdOf(request) });
    }
  });
}
