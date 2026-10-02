import { shutdownTelemetry } from './instrumentation';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureHttpApp } from './app.setup';
import { AUTH_MODE, OIDC, PORT } from './config';
import { assertConfigured, StructuredLogger } from '@wonseoro/server-kit';

/**
 * central-api — 중앙 Control + Convenience Plane
 *
 * **이 서비스는 지원자 요청의 Critical Path 에 들어가지 않는다.** (v1.0 §3.1)
 * 이 프로세스가 죽어 있어도 대학 접수는 계속되어야 한다.
 * 그것을 증명하는 것이 M2 Demo Gate 5 다.
 */
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

  // 파서·추적·인증·CORS — 시험과 같은 조립 (app.setup.ts)
  configureHttpApp(app);

  const port = PORT;
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('central-api').log(`listening on :${port} (auth=${AUTH_MODE}${OIDC ? `, 지원자 발급자 ${OIDC.applicantIssuer}` : ''})`);
}

void bootstrap();
