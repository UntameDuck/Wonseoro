"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const payment_provider_1 = require("./payment.provider");
(0, node_test_1.describe)('Mock PG 지연 모드 (T-M4-34 실제 시간 판)', () => {
    (0, node_test_1.afterEach)(() => {
        delete process.env.MOCK_PG_CONFIRM_DELAYS_S;
    });
    (0, node_test_1.it)('지연 목록을 차례로 거래 ID 에 새기고, 지연 동안은 UNKNOWN 이다', async () => {
        process.env.MOCK_PG_CONFIRM_DELAYS_S = '60,1800';
        const pg = new payment_provider_1.MockPaymentProvider();
        const a = await pg.createIntent('app-1', 55_000);
        const b = await pg.createIntent('app-2', 55_000);
        const c = await pg.createIntent('app-3', 55_000);
        strict_1.default.equal((0, payment_provider_1.parseDelayed)(a.providerTxId)?.delayMs, 60_000);
        strict_1.default.equal((0, payment_provider_1.parseDelayed)(b.providerTxId)?.delayMs, 1_800_000);
        strict_1.default.equal((0, payment_provider_1.parseDelayed)(c.providerTxId)?.delayMs, 60_000);
        strict_1.default.equal((await pg.verify(a.providerTxId)).status, 'UNKNOWN');
    });
    (0, node_test_1.it)('지연이 지나면 CONFIRMED 이고 승인 시각은 결제 시각이다 — 늦은 확인이 마감 판정을 바꾸지 않는다', async () => {
        const paidAt = Date.now() - 61_000;
        const txId = `MOCK-D60-${paidAt.toString(36).toUpperCase()}-ABCDEF123456`;
        const result = await new payment_provider_1.MockPaymentProvider().verify(txId);
        strict_1.default.equal(result.status, 'CONFIRMED');
        strict_1.default.equal(result.providerApprovedAt, new Date(paidAt).toISOString());
    });
    (0, node_test_1.it)('지연 모드가 아니면 거래 ID 형식과 동작이 그대로다', async () => {
        const pg = new payment_provider_1.MockPaymentProvider();
        const intent = await pg.createIntent('app-1', 55_000);
        strict_1.default.match(intent.providerTxId, /^MOCK-[0-9A-F]{20}$/);
        strict_1.default.equal((0, payment_provider_1.parseDelayed)(intent.providerTxId), null);
        strict_1.default.equal((await pg.verify(intent.providerTxId)).status, 'CONFIRMED');
    });
});
//# sourceMappingURL=payment.provider.test.js.map