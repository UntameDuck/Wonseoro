import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * HTTP 조립 시험 — 브라우저 사전 요청(CORS preflight)이 계약의 모든 메서드를 허용하는가 (D-66)
 *
 * NestJS 11(@fastify/cors 11)은 허용 메서드 기본값이 GET·HEAD·POST 다. 조립에서 적지 않으면 지원자 화면이
 * 원서 저장(PATCH)·서류 삭제(DELETE)를 브라우저에서 보낼 수 없는데, 서버 대 서버 시험은 사전 요청을 하지 않아 못 잡는다.
 * 실제 조립(app.setup.ts)으로 사전 요청을 보내 본다. DB 없이 돈다.
 */
process.env.UNIVERSITY_ID ??= 'UNIV-CORS';
process.env.CORS_ORIGINS = 'http://localhost:4001';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';

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
  for (const [method, url] of [
    ['PATCH', '/api/v1/applications/00000000-0000-4000-8000-000000000000'],
    ['DELETE', '/api/v1/documents/00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/v1/applications'],
  ] as const) {
    it(`지원자 화면 오리진의 ${method} 를 허용한다`, async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin: 'http://localhost:4001',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type,idempotency-key,if-match',
        },
      });
      assert.ok(res.statusCode < 300, `${res.statusCode}`);
      assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:4001');
      assert.ok(String(res.headers['access-control-allow-methods']).split(',').map((m) => m.trim()).includes(method), String(res.headers['access-control-allow-methods']));
    });
  }

  it('다른 오리진에는 허용하지 않는다', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/applications',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    assert.notEqual(res.headers['access-control-allow-origin'], 'https://evil.example');
  });
});
