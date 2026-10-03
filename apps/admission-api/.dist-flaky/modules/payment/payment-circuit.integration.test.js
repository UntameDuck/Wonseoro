"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const config_1 = require("../../config");
const audit_service_1 = require("../audit/audit.service");
const payment_provider_1 = require("./payment.provider");
const payment_service_1 = require("./payment.service");
const break_glass_1 = require("../../test-support/break-glass");
/**
 * PG Circuit Breaker 통합 테스트 — 실제 PostgreSQL 이 필요하다. (v1.1 §01 C8·§B4)
 *
 * 확인할 것은 하나다. **PG 가 끊겨도 확인 못 한 결제가 CONFIRMED 가 되지 않는다.**
 * 그리고 끊긴 뒤에는 PG 에 묻지 않아 대기가 쌓이지 않는다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db;
let available = false;
let applicantId;
/** PG 에 닿지 않는 상황. 몇 번 불렸는지 센다 — 열린 뒤에는 불리면 안 된다. */
class UnreachablePg extends payment_provider_1.PaymentProviderPort {
    name = 'mock-pg';
    calls = 0;
    down = true;
    async createIntent() {
        this.calls += 1;
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    async verify() {
        this.calls += 1;
        if (this.down) {
            throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        }
        return { status: 'CONFIRMED', providerApprovedAt: new Date().toISOString() };
    }
    async cancel() {
        return { status: 'CANCELLED' };
    }
    async reconcile() {
        return [];
    }
    verifyCallback() {
        return null;
    }
}
async function seedApplication() {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'PAYMENT_PENDING')`, [id, CYCLE, applicantId, TYPE, DEPT]);
    return id;
}
async function seedPayment(appId, status) {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
     VALUES ($1,$2,'mock-pg',$3,55000,$4)`, [id, appId, `TX-${(0, node_crypto_1.randomUUID)().slice(0, 12)}`, status]);
    return id;
}
async function statusOf(paymentId) {
    const { rows } = await db.query(`SELECT status FROM payment WHERE id = $1`, [
        paymentId,
    ]);
    return rows[0].status;
}
async function cleanup(appId) {
    // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
    await (0, break_glass_1.breakGlass)(async (client) => {
        await client.query(`DELETE FROM audit_event WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM payment_event WHERE payment_id IN
         (SELECT id FROM payment WHERE application_id = $1)`, [appId]);
        await client.query(`DELETE FROM payment WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM application WHERE id = $1`, [appId]);
    });
}
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    applicantId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`, [applicantId, `subj-pgcb-${applicantId.slice(0, 8)}`]);
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('PG Circuit Breaker (v1.1 §01 C8·§B4)', () => {
    (0, node_test_1.it)('PG 에 닿지 않으면 UNKNOWN 으로 두고, 이유를 증적에 남긴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        try {
            const paymentId = await seedPayment(appId, 'PENDING');
            const service = new payment_service_1.PaymentService(db, new UnreachablePg(), new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
            const result = await service.verify(paymentId);
            strict_1.default.equal(result.status, 'UNKNOWN', 'FAILED 로 떨어뜨리면 재결제를 유도한다');
            strict_1.default.equal(await statusOf(paymentId), 'UNKNOWN');
            const { rows } = await db.query(`SELECT payload_redacted FROM payment_event WHERE payment_id = $1`, [paymentId]);
            strict_1.default.equal(rows[0]?.payload_redacted.unverifiedCause, 'ECONNREFUSED');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('회로가 열리면 PG 에 묻지 않고, 그래도 CONFIRMED 로 넘기지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        try {
            const pg = new UnreachablePg();
            const breakers = new dependency_breakers_1.DependencyBreakers();
            const service = new payment_service_1.PaymentService(db, pg, new audit_service_1.AuditService(), breakers);
            // 연속 실패로 회로를 연다.
            const tripping = await seedPayment(appId, 'PENDING');
            for (let i = 0; i < config_1.BREAKER.failureThreshold; i += 1)
                await service.verify(tripping);
            strict_1.default.equal(breakers.paymentGateway.state, 'OPEN');
            strict_1.default.equal(pg.calls, config_1.BREAKER.failureThreshold);
            const fresh = await seedPayment(appId, 'CREATED');
            const result = await service.verify(fresh);
            strict_1.default.equal(pg.calls, config_1.BREAKER.failureThreshold, '열린 회로는 PG 에 닿지 않아야 한다');
            strict_1.default.equal(result.status, 'UNKNOWN');
            const { rows } = await db.query(`SELECT payload_redacted FROM payment_event WHERE payment_id = $1`, [fresh]);
            strict_1.default.equal(rows[0]?.payload_redacted.unverifiedCause, 'CIRCUIT_OPEN');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('이미 결론이 난 결제는 PG 가 끊겨도 건드리지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        try {
            const service = new payment_service_1.PaymentService(db, new UnreachablePg(), new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
            // FAILED 를 UNKNOWN 으로 되돌리면 이미 끝난 사실이 다시 불확실해진다.
            const failed = await seedPayment(appId, 'FAILED');
            strict_1.default.equal((await service.verify(failed)).status, 'FAILED');
            strict_1.default.equal(await statusOf(failed), 'FAILED');
            // 이미 UNKNOWN 이면 같은 사실을 매번 새로 기록하지 않는다.
            const unknown = await seedPayment(appId, 'UNKNOWN');
            await service.verify(unknown);
            const { rows } = await db.query(`SELECT 1 FROM payment_event WHERE payment_id = $1`, [unknown]);
            strict_1.default.equal(rows.length, 0);
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('PG 가 살아나면 UNKNOWN 이던 결제도 확정된다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        try {
            const pg = new UnreachablePg();
            const service = new payment_service_1.PaymentService(db, pg, new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
            const paymentId = await seedPayment(appId, 'PENDING');
            strict_1.default.equal((await service.verify(paymentId)).status, 'UNKNOWN');
            pg.down = false;
            strict_1.default.equal((await service.verify(paymentId)).status, 'CONFIRMED');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('결제 의도 생성은 503 으로 거절하고 결제 행을 만들지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        try {
            const service = new payment_service_1.PaymentService(db, new UnreachablePg(), new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
            await strict_1.default.rejects(service.createIntent(appId, applicantId, {}), (err) => err instanceof problem_exception_1.ProblemException && err.getStatus() === 503);
            const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [appId]);
            strict_1.default.equal(rows.length, 0, '결제창이 열리지 않았으므로 남길 결제도 없다');
        }
        finally {
            await cleanup(appId);
        }
    });
});
//# sourceMappingURL=payment-circuit.integration.test.js.map