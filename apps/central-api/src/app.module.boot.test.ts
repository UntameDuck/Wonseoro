import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * 모듈 조립 시험 — 실제 AppModule 로 의존성 그래프를 만든다.
 *
 * 통합 시험은 컨트롤러·서비스를 직접 만들어 Nest 의 의존성 주입을 거치지 않는다.
 * "시험은 통과하는데 서버가 뜨지 않는" 결함을 여기서 잡는다. DB 없이도 돈다 — 연결 풀은 첫 쿼리 때 연결한다.
 */
let app: INestApplicationContext | null = null;

after(async () => {
  await app?.close();
});

describe('central-api AppModule 조립', () => {
  it('모든 provider 의 의존성이 풀린다 — 서버가 뜬다', async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('./app.module');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
    const { ApplicantProfileController } = await import('./modules/profile-vault/profile-vault.controller');
    assert.ok(app.get(ApplicantProfileController));
  });
});
