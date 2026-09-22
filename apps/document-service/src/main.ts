import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * document-service — 악성코드 검사 워커
 *
 * 분리하는 이유는 하나다. **검사는 오래 걸리고 CPU 를 쓴다.**
 * 마감 피크에 접수 트랜잭션과 자원을 다투면 안 된다. (v1.1 §B5, ADR-0004)
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3002);
  await app.listen({ port, host: '0.0.0.0' });
  new Logger('document-service').log(
    `listening on :${port} → ${process.env.ADMISSION_API_URL ?? 'http://localhost:3001'}`,
  );
}

void bootstrap();
