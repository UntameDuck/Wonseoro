import { shutdownTelemetry } from './instrumentation';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AUTH_MODE, CORS_ORIGINS, PORT } from './config';
import { assertConfigured, installHttpTelemetry, StructuredLogger } from '@wonseoro/server-kit';

/**
 * central-api — 중앙 Control + Convenience Plane
 *
 * **이 서비스는 지원자 요청의 Critical Path 에 들어가지 않는다.** (v1.0 §3.1)
 * 이 프로세스가 죽어 있어도 대학 접수는 계속되어야 한다.
 * 그것을 증명하는 것이 M2 Demo Gate 5 다.
 */
/** 잘못된 바이트를 U+FFFD 로 바꾸지 않고 실패한다. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

async function bootstrap(): Promise<void> {
  // 설정을 먼저 확인한다. 잘못된 설정으로 뜨는 것보다 안 뜨는 것이 낫다.
  assertConfigured();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
    // 본문 파서는 아래에서 직접 등록한다 — Nest 가 자기 JSON 파서를 올리면 깨진 UTF-8 을 받아들인다(D-37)
    { bodyParser: false, logger: new StructuredLogger('central-api') },
  );
  app.enableShutdownHooks();
  process.once('beforeExit', () => void shutdownTelemetry());

  // 대학이 보내는 CloudEvents 미디어 타입.
  // parseAs 는 'buffer' 여야 한다. 'string' 이면 한글 본문에서 길이 검증이 깨진다.
  const fastify = app.getHttpAdapter().getInstance();
  // 대학 Relay 가 보낸 traceparent 를 이어 받는다 — Outbox 전송이 한 trace 로 보인다 (T-M4-20)
  installHttpTelemetry(fastify);
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
      // 개발용 신원 헤더. gateway 모드에서는 받지 않는다 — 브라우저가 신원을 직접 주장할 통로를 두지 않는다.
      ...(AUTH_MODE === 'dev-headers' ? ['x-subject-token'] : []),
    ],
    exposedHeaders: ['etag'],
  });

  const port = PORT;
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('central-api').log(`listening on :${port}`);
}

void bootstrap();
