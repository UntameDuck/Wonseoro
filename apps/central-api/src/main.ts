import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * central-api — 중앙 Control + Convenience Plane
 *
 * **이 서비스는 지원자 요청의 Critical Path 에 들어가지 않는다.** (v1.0 §3.1)
 * 이 프로세스가 죽어 있어도 대학 접수는 계속되어야 한다.
 * 그것을 증명하는 것이 M2 Demo Gate 5 다.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1_048_576 }),
  );

  // 대학이 보내는 CloudEvents 미디어 타입.
  // parseAs 는 'buffer' 여야 한다. 'string' 이면 한글 본문에서 길이 검증이 깨진다.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(
    'application/cloudevents+json',
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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('central-api').log(`listening on :${port}`);
}

void bootstrap();
