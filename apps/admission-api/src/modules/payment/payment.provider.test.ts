import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MockPaymentProvider, parseDelayed } from './payment.provider';

describe('Mock PG 지연 모드 (T-M4-34 실제 시간 판)', () => {
  afterEach(() => {
    delete process.env.MOCK_PG_CONFIRM_DELAYS_S;
  });

  it('지연 목록을 차례로 거래 ID 에 새기고, 지연 동안은 UNKNOWN 이다', async () => {
    process.env.MOCK_PG_CONFIRM_DELAYS_S = '60,1800';
    const pg = new MockPaymentProvider();
    const a = await pg.createIntent('app-1', 55_000);
    const b = await pg.createIntent('app-2', 55_000);
    const c = await pg.createIntent('app-3', 55_000);
    assert.equal(parseDelayed(a.providerTxId)?.delayMs, 60_000);
    assert.equal(parseDelayed(b.providerTxId)?.delayMs, 1_800_000);
    assert.equal(parseDelayed(c.providerTxId)?.delayMs, 60_000);
    assert.equal((await pg.verify(a.providerTxId)).status, 'UNKNOWN');
  });

  it('지연이 지나면 CONFIRMED 이고 승인 시각은 결제 시각이다 — 늦은 확인이 마감 판정을 바꾸지 않는다', async () => {
    const paidAt = Date.now() - 61_000;
    const txId = `MOCK-D60-${paidAt.toString(36).toUpperCase()}-ABCDEF123456`;
    const result = await new MockPaymentProvider().verify(txId);
    assert.equal(result.status, 'CONFIRMED');
    assert.equal(result.providerApprovedAt, new Date(paidAt).toISOString());
  });

  it('지연 모드가 아니면 거래 ID 형식과 동작이 그대로다', async () => {
    const pg = new MockPaymentProvider();
    const intent = await pg.createIntent('app-1', 55_000);
    assert.match(intent.providerTxId, /^MOCK-[0-9A-F]{20}$/);
    assert.equal(parseDelayed(intent.providerTxId), null);
    assert.equal((await pg.verify(intent.providerTxId)).status, 'CONFIRMED');
  });
});
