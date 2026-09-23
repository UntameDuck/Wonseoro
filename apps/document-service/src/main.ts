import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ADMISSION_API_URL, PORT, SCANNER_ENGINE } from './config';
import { assertConfigured } from '@wonseoro/server-kit';

/**
 * document-service — 악성코드 검사 워커
 *
 * 분리하는 이유는 하나다. **검사는 오래 걸리고 CPU 를 쓴다.**
 * 마감 피크에 접수 트랜잭션과 자원을 다투면 안 된다. (v1.1 §B5, ADR-0004)
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
  new Logger('document-service').log(
    `listening on :${port} → ${ADMISSION_API_URL} (engine=${SCANNER_ENGINE})`,
  );
}

void bootstrap();
