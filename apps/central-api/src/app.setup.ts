import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { installHttpTelemetry } from '@wonseoro/server-kit';
import { AUTH_MODE, CORS_ORIGINS } from './config';
import { createApplicantVerifier, installOidcAuthentication } from './oidc-auth';

/** 잘못된 바이트를 U+FFFD 로 바꾸지 않고 실패한다. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * HTTP 계층 조립 — 본문 파서·추적·인증·CORS. main.ts 와 HTTP 시험(oidc-auth.integration.test.ts)이 같은 조립을 쓴다.
 */
export function configureHttpApp(app: NestFastifyApplication): void {
  // 대학이 보내는 CloudEvents 미디어 타입.
  // parseAs 는 'buffer' 여야 한다. 'string' 이면 한글 본문에서 길이 검증이 깨진다.
  const fastify = app.getHttpAdapter().getInstance();
  // 대학 Relay 가 보낸 traceparent 를 이어 받는다 — Outbox 전송이 한 trace 로 보인다 (T-M4-20)
  installHttpTelemetry(fastify);
  // 지원자 토큰 검증 — 지원자 API(/api/v1) 앞에서 (T-M5-02 단계 4)
  if (AUTH_MODE === 'oidc') installOidcAuthentication(fastify, createApplicantVerifier());
  // 지원자가 공통원서를 쓰는 API 가 생겼다(D-57). 기본 JSON 파서는 깨진 UTF-8 을 U+FFFD 로 바꿔
  // 받아들인다 — 한글 학교 이름이 깨진 채 저장되고 여러 대학 원서로 복사된다. 거절한다. (D-37 과 같은 규칙)
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: unknown, body: Buffer, done: (err: Error | null, value?: unknown) => void) => {
      let text: string;
      try {
        text = utf8.decode(body);
      } catch {
        done(Object.assign(new Error('요청 본문이 UTF-8 이 아닙니다. 한글이 깨진 채 저장되지 않도록 거절했습니다.'), { statusCode: 400 }));
        return;
      }
      try {
        done(null, text === '' ? {} : JSON.parse(text));
      } catch {
        done(Object.assign(new Error('요청 본문이 올바른 JSON 이 아닙니다.'), { statusCode: 400 }));
      }
    },
  );
  fastify.addContentTypeParser(
    'application/cloudevents+json',
    { parseAs: 'buffer' },
    (_req: unknown, body: Buffer, done: (err: Error | null, value?: unknown) => void) => {
      try {
        const text = utf8.decode(body);
        done(null, text === '' ? {} : JSON.parse(text));
      } catch {
        // 깨진 이벤트는 재시도해도 안 된다 — 400 이면 Relay 가 사람이 볼 곳(DEAD)으로 보낸다
        done(Object.assign(new Error('이벤트 본문이 UTF-8 JSON 이 아닙니다.'), { statusCode: 400 }));
      }
    },
  );

  // 대학 Data Plane 과 지원자 웹은 서로 다른 도메인에 있다. (v1.1 §10 §11)
  // 운영에서는 Edge 라우팅으로 같은 오리진처럼 묶고 Allowlist 를 좁힌다. (v1.1 §06 CORS Allowlist)
  app.enableCors({
    origin: CORS_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'if-match',
      'traceparent',
      // 지원자 화면이 액세스 토큰을 보낸다 (oidc)
      ...(AUTH_MODE === 'oidc' ? ['authorization'] : []),
      // 개발용 신원 헤더. 다른 모드에서는 받지 않는다 — 브라우저가 신원을 직접 주장할 통로를 두지 않는다.
      ...(AUTH_MODE === 'dev-headers' ? ['x-subject-token'] : []),
    ],
    exposedHeaders: ['etag', 'www-authenticate'],
  });
}
