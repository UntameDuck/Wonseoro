import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { MEDIA_MERGE_PATCH } from '@wonseoro/contracts';
import { AppModule } from './app.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IdempotencyStore } from './common/idempotency/idempotency.store';
import { ProblemFilter } from './common/problem/problem.filter';

/**
 * admission-api — 대학 Data Plane 메인 API
 *
 * 이 서비스에서 커밋된 것만 "접수됨"이다. (기술설계서 v1.1 §02)
 * 중앙(central-api)은 이 서비스의 Critical Path 에 들어가지 않는다.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: Edge/WAF 뒤에 있으므로 원 IP 판단에 필요하다.
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
  );

  // OpenAPI updateApplication 이 application/merge-patch+json 을 요구한다.
  // Fastify 는 기본 파서가 없으므로 JSON 파서에 이 미디어 타입을 등록한다.
  const fastify = app.getHttpAdapter().getInstance();
  // parseAs 는 'buffer' 여야 한다. 'string' 을 쓰면 Fastify 가 문자 수와
  // Content-Length(바이트 수)를 비교해 한글 본문에서 전부 실패한다.
  // 원서 본문은 대부분 한글이므로 이 구분이 치명적이다.
  fastify.addContentTypeParser(
    MEDIA_MERGE_PATCH,
    { parseAs: 'buffer' },
    (_req: unknown, body: Buffer, done: (err: Error | null, value?: unknown) => void) => {
      try {
        const text = body.toString('utf8');
        done(null, text === '' ? {} : JSON.parse(text));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // 모든 오류를 problem+json 으로 통일한다.
  app.useGlobalFilters(new ProblemFilter());

  // 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음.
  app.useGlobalInterceptors(new IdempotencyInterceptor(app.get(IdempotencyStore)));

  // 대학 Data Plane 과 지원자 웹은 서로 다른 도메인에 있다. (v1.1 §10 §11)
  // 운영에서는 Edge 라우팅으로 같은 오리진처럼 묶고 Allowlist 를 좁힌다. (v1.1 §06 CORS Allowlist)
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4000').split(','),
    credentials: true,
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'if-match',
      'traceparent',
      'x-applicant-id',
      'x-subject-token',
    ],
    exposedHeaders: ['etag'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });

  new Logger('admission-api').log(
    `listening on :${port} (university=${process.env.UNIVERSITY_ID ?? 'UNSET'})`,
  );
}

void bootstrap();
