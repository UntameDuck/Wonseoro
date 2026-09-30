import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * 모듈 조립 시험 — 실제 AppModule 로 의존성 그래프를 만든다.
 *
 * 단위·통합 시험은 서비스를 직접 `new` 로 만들어 Nest 의 의존성 주입을 거치지 않는다.
 * 그래서 "시험은 전부 통과하는데 서버가 뜨지 않는" 결함을 못 잡는다 — 실제로 생성자 기본값
 * 인자를 DI 가 풀지 못해 admission-api 가 기동하지 않은 적이 있다(ClockMonitor, 2026-09-30).
 *
 * DB 없이도 돈다 — 연결 풀은 첫 쿼리 때 연결한다. 주기 작업은 꺼서 타이머가 남지 않게 한다.
 */
process.env.UNIVERSITY_ID ??= 'UNIV-BOOT';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';

let app: INestApplicationContext | null = null;

after(async () => {
  await app?.close();
});

describe('AppModule 조립', () => {
  it('모든 provider 의 의존성이 풀린다 — 서버가 뜬다', async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('./app.module');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
    const { ClockMonitor } = await import('./common/time/server-clock');
    const { ReconciliationService } = await import('./modules/reconciliation/reconciliation.service');
    assert.ok(app.get(ClockMonitor));
    // PG 정산 대조는 결제 모듈의 어댑터를 받아야 동작한다 — 빠지면 9번 대조가 조용히 꺼진다
    const reconciliation = app.get(ReconciliationService) as unknown as { provider?: unknown; payments?: unknown };
    assert.ok(reconciliation.provider, 'ReconciliationService 에 PG 어댑터가 주입되지 않았다');
    assert.ok(reconciliation.payments, 'ReconciliationService 에 결제 서비스가 주입되지 않았다');
  });
});
