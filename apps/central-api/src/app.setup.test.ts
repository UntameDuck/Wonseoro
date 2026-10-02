import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * HTTP 조립 시험 — 브라우저 사전 요청이 공통원서 저장(PUT)을 허용하는가 (D-66)
 * NestJS 11(@fastify/cors 11)의 허용 메서드 기본값은 GET·HEAD·POST 다. DB 없이 돈다.
 */
process.env.CORS_ORIGINS = 'http://localhost:4001';

let app: NestFastifyApplication;

before(async () => {
  const { NestFactory } = await import('@nestjs/core');
  const { FastifyAdapter } = await import('@nestjs/platform-fastify');
  const { AppModule } = await import('./app.module');
  const { configureHttpApp } = await import('./app.setup');
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false, bodyParser: false });
  configureHttpApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => {
  await app?.close();
});

describe('브라우저 사전 요청 (D-66)', () => {
  it('지원자 화면 오리진의 공통원서 저장(PUT)을 허용한다', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/profile',
      headers: { origin: 'http://localhost:4001', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    assert.ok(res.statusCode < 300, `${res.statusCode}`);
    assert.ok(String(res.headers['access-control-allow-methods']).split(',').map((m) => m.trim()).includes('PUT'), String(res.headers['access-control-allow-methods']));
  });
});
