import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * event-relay — Outbox 를 중앙으로 보낸다.
 *
 * 별도 프로세스인 이유는 하나다.
 * **중앙 장애가 접수 API 로 전파되지 않게 하기 위함이다.** (v1.1 §10 §12)
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3003);
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('event-relay').log(
    `listening on :${port} (university=${process.env.UNIVERSITY_ID ?? 'UNSET'} → ${process.env.CENTRAL_SYNC_URL ?? 'http://localhost:3000'})`,
  );
}

void bootstrap();
