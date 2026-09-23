import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { CENTRAL_SYNC_URL, PORT, UNIVERSITY_ID } from './config';
import { assertConfigured } from '@wonseoro/server-kit';

/**
 * event-relay — Outbox 를 중앙으로 보낸다.
 *
 * 별도 프로세스인 이유는 하나다.
 * **중앙 장애가 접수 API 로 전파되지 않게 하기 위함이다.** (v1.1 §10 §12)
 */
async function bootstrap(): Promise<void> {
  // 설정을 먼저 확인한다. 잘못된 설정으로 뜨는 것보다 안 뜨는 것이 낫다.
  assertConfigured();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();

  const port = PORT;
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('event-relay').log(
    `listening on :${port} (university=${UNIVERSITY_ID} → ${CENTRAL_SYNC_URL})`,
  );
}

void bootstrap();
