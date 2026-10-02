import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MEDIA_MERGE_PATCH } from '@wonseoro/contracts';
import { installHttpTelemetry } from '@wonseoro/server-kit';
import { AUTH_MODE, CORS_ORIGINS } from './config';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IdempotencyStore } from './common/idempotency/idempotency.store';
import { installOidcAuthentication, OidcAuthenticator } from './common/identity/oidc-auth';
import { ProblemFilter } from './common/problem/problem.filter';
import { installAdaptiveThrottle } from './common/throttle/throttle.hook';
import { strictJsonParser } from './common/http/strict-json';
import { installUuidParamGuard } from './common/http/uuid-params';

/**
 * HTTP 계층 조립 — 본문 파서·인증·요청 한도·오류 형식·멱등성·CORS.
 *
 * main.ts 와 HTTP 수준 시험(oidc-auth.integration.test.ts)이 **같은 조립**을 쓴다. 시험이 따로 조립하면
 * 훅 순서(인증 → 한도)가 운영과 달라져도 시험은 통과한다.
 */
export function configureHttpApp(app: NestFastifyApplication): void {
  // OpenAPI updateApplication 이 application/merge-patch+json 을 요구한다.
  // Fastify 는 기본 파서가 없으므로 JSON 파서에 이 미디어 타입을 등록한다.
  const fastify = app.getHttpAdapter().getInstance();
  // parseAs 는 'buffer' 여야 한다. 'string' 을 쓰면 Fastify 가 문자 수와
  // Content-Length(바이트 수)를 비교해 한글 본문에서 전부 실패한다.
  // 원서 본문은 대부분 한글이므로 이 구분이 치명적이다.
  fastify.addContentTypeParser(MEDIA_MERGE_PATCH, { parseAs: 'buffer' }, strictJsonParser);
  // 기본 JSON 파서는 깨진 UTF-8 을 U+FFFD 로 바꿔 받아들인다. 거절하도록 바꾼다. (D-37)
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, strictJsonParser);
  installHttpTelemetry(fastify);
  // 토큰 검증 — 요청 한도보다 먼저. 한도는 인증된 지원자 기준이다 (T-M5-02)
  if (AUTH_MODE === 'oidc') installOidcAuthentication(fastify, app.get(OidcAuthenticator));
  // 지원자 단위 Adaptive Throttling — IP 가 아니라 세션·원서 기준 (T-M4-40)
  installAdaptiveThrottle(fastify);
  // 형식이 틀린 식별자는 DB 에 가기 전에 404 — 전에는 uuid 변환 오류로 500 이었다
  installUuidParamGuard(fastify);
  // API 응답을 브라우저가 다른 형식으로 추측하지 않게 한다. 파일·오류 응답에도 동일하게 적용한다.
  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  // 모든 오류를 problem+json 으로 통일한다.
  app.useGlobalFilters(new ProblemFilter());

  // 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음.
  app.useGlobalInterceptors(new IdempotencyInterceptor(app.get(IdempotencyStore), app.get(Reflector)));

  // 대학 Data Plane 과 지원자 웹은 서로 다른 도메인에 있다. (v1.1 §10 §11)
  // 운영에서는 Edge 라우팅으로 같은 오리진처럼 묶고 Allowlist 를 좁힌다. (v1.1 §06 CORS Allowlist)
  app.enableCors({
    origin: CORS_ORIGINS,
    credentials: true,
    // 메서드를 적는다 — NestJS 11 의 CORS(@fastify/cors 11)는 기본이 GET·HEAD·POST 뿐이라, 적지 않으면 브라우저가
    // 원서 저장(PATCH)·공통원서 저장(PUT)·서류 삭제(DELETE)를 사전 요청에서 거절당한다 (D-66)
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'if-match',
      'traceparent',
      // 지원자 화면이 액세스 토큰을 보낸다 (oidc)
      ...(AUTH_MODE === 'oidc' ? ['authorization'] : []),
      // 개발용 신원 헤더. 다른 모드에서는 받지 않는다 — 브라우저가 신원을
      // 직접 주장할 수 있는 통로를 열어둘 이유가 없다.
      ...(AUTH_MODE === 'dev-headers' ? ['x-applicant-id', 'x-subject-token'] : []),
    ],
    // retry-after 는 CORS 기본 노출 헤더가 아니다 — 화면이 429 뒤 기다릴 시간을 읽어야 한다 (D-51)
    // www-authenticate — 재인증(step-up)이 필요할 때 화면이 요구 수준·시간을 읽는다 (RFC 9470)
    exposedHeaders: ['etag', 'retry-after', 'www-authenticate'],
  });
}
