import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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

  // 모든 오류를 problem+json 으로 통일한다.
  app.useGlobalFilters(new ProblemFilter());

  // 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음.
  app.useGlobalInterceptors(new IdempotencyInterceptor(app.get(IdempotencyStore)));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });

  new Logger('admission-api').log(
    `listening on :${port} (university=${process.env.UNIVERSITY_ID ?? 'UNSET'})`,
  );
}

void bootstrap();
