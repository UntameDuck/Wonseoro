"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const core_1 = require("@nestjs/core");
const rxjs_1 = require("rxjs");
const server_kit_1 = require("@wonseoro/server-kit");
const idempotency_interceptor_1 = require("../../common/idempotency/idempotency.interceptor");
const problem_exception_1 = require("../../common/problem/problem.exception");
const leader_lock_1 = require("../../common/scheduling/leader-lock");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const config_1 = require("../../config");
const audit_service_1 = require("../audit/audit.service");
const reconciliation_scheduler_1 = require("../reconciliation/reconciliation.scheduler");
const payment_callback_controller_1 = require("./payment-callback.controller");
const payment_recheck_worker_1 = require("./payment-recheck.worker");
const payment_provider_1 = require("./payment.provider");
const payment_service_1 = require("./payment.service");
const break_glass_1 = require("../../test-support/break-glass");
/**
 * 결제 자동 정합화 (D-40) — 실제 PostgreSQL 이 필요하다.
 *
 * 확인할 것
 *   - 서명이 맞지 않는 콜백은 아무것도 바꾸지 않는다
 *   - 같은 콜백은 한 번만 처리되고, 상태는 콜백이 아니라 PG 재조회로 정해진다
 *   - 결제 확인 뒤의 접수는 결제 모듈이 아니라 접수 모듈의 일이다 (D-42, auto-finalize 시험)
 *   - 재확인 워커는 PENDING·UNKNOWN 만, Backoff 간격이 지난 것만 묻는다
 *   - 여러 Pod 중 하나만 돈다
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db;
let available = false;
const apps = [];
const applicants = [];
function sign(body) {
    return (0, node_crypto_1.createHmac)('sha256', config_1.PG_CALLBACK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
}
function callbackRequest(body, signature) {
    return {
        headers: signature ? { 'x-pg-signature': signature } : {},
        rawBody: Buffer.from(body, 'utf8'),
        ip: '127.0.0.1',
    };
}
/** 지원자마다 활성 원서는 하나다(자연키). 원서마다 지원자를 새로 만든다. */
async function seedApplication() {
    const id = (0, node_crypto_1.randomUUID)();
    const applicantId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`, [applicantId, `subj-recon-${applicantId.slice(0, 8)}`]);
    applicants.push(applicantId);
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'PAYMENT_PENDING')`, [id, CYCLE, applicantId, TYPE, DEPT]);
    apps.push(id);
    return id;
}
async function seedPayment(appId, opts) {
    const id = (0, node_crypto_1.randomUUID)();
    const txId = opts.txId ?? `MOCK-RC${(0, node_crypto_1.randomUUID)().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at, created_at)
     VALUES ($1,$2,'mock-pg',$3,55000,$4,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() - $5::interval END,
             now() - $6::interval)`, [id, appId, txId, opts.status, opts.verifiedAgo ?? null, opts.createdAgo ?? '0 seconds']);
    return { id, txId };
}
async function addVerifyEvents(paymentId, n) {
    for (let i = 0; i < n; i += 1) {
        await db.query(`INSERT INTO payment_event (id, payment_id, event_type, payload_hash, occurred_at)
       VALUES ($1,$2,'VERIFY_PENDING','h',now())`, [(0, node_crypto_1.randomUUID)(), paymentId]);
    }
}
async function events(paymentId) {
    const { rows } = await db.query(`SELECT event_type FROM payment_event WHERE payment_id = $1 ORDER BY received_at`, [paymentId]);
    return rows.map((r) => r.event_type);
}
async function statusOf(paymentId) {
    const { rows } = await db.query(`SELECT status FROM payment WHERE id = $1`, [paymentId]);
    return rows[0].status;
}
function realService() {
    return new payment_service_1.PaymentService(db, new payment_provider_1.MockPaymentProvider(), new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
}
/** 실제 verify 대신 누구를 물었는지만 적는다. 다른 시험 파일의 결제를 건드리지 않기 위해서다. */
function recordingService() {
    const asked = [];
    const service = {
        async verify(id) {
            asked.push(id);
            return { id, status: 'PENDING' };
        },
    };
    return { service, asked };
}
/** 다른 Pod 가 잠금을 쥐고 있는 상황 — withLeaderLock 과 같은 트랜잭션 잠금·같은 키 (D-54). */
async function holdLock(name) {
    const client = await db.pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok`, [leader_lock_1.LEADER_LOCK_CLASS, name]);
    strict_1.default.equal(rows[0]?.ok, true);
    return async () => {
        await client.query('COMMIT');
        client.release();
    };
}
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
    await (0, break_glass_1.breakGlass)(async (client) => {
        // 동시에 도는 대조 시험이 이 원서들에 예외를 달 수 있다(확인된 결제 · 접수 없음).
        // 원서 행을 먼저 잠가, 예외를 지운 뒤 원서를 지우는 사이에 새 예외가 끼지 못하게 한다.
        await client.query(`SELECT id FROM application WHERE id = ANY($1) FOR UPDATE`, [apps]);
        await client.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
        await client.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
        await client.query(`DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`, [apps]);
        await client.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
        await client.query(`DELETE FROM application WHERE id = ANY($1)`, [apps]);
        await client.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('PG 콜백 (D-40)', () => {
    (0, node_test_1.it)('Idempotency-Key 없이 들어와도 인터셉터가 막지 않는다 — PG 는 우리 헤더를 모른다', async () => {
        const store = {
            acquire: () => {
                throw new Error('콜백에 멱등 저장소를 쓰면 안 된다');
            },
        };
        const interceptor = new idempotency_interceptor_1.IdempotencyInterceptor(store, new core_1.Reflector());
        const ctx = {
            switchToHttp: () => ({ getRequest: () => ({ method: 'POST', headers: {}, url: '/api/v1/payments/callbacks/mock-pg' }) }),
            getHandler: () => payment_callback_controller_1.PaymentCallbackController.prototype.receive,
        };
        const out = await (0, rxjs_1.lastValueFrom)(interceptor.intercept(ctx, { handle: () => (0, rxjs_1.of)('ok') }));
        strict_1.default.equal(out, 'ok');
    });
    (0, node_test_1.it)('서명이 맞지 않으면 403 이고 아무것도 기록하지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        const { id, txId } = await seedPayment(appId, { status: 'PENDING' });
        const service = realService();
        const controller = new payment_callback_controller_1.PaymentCallbackController(service, new payment_provider_1.MockPaymentProvider());
        const body = JSON.stringify({ providerTxId: txId, eventId: 'evt-forged' });
        for (const sig of [undefined, 'deadbeef', sign(body + ' ')]) {
            await strict_1.default.rejects(controller.receive('mock-pg', callbackRequest(body, sig)), (err) => err instanceof problem_exception_1.ProblemException && err.getStatus() === 403);
        }
        strict_1.default.deepEqual(await events(id), []);
        strict_1.default.equal(await statusOf(id), 'PENDING');
    });
    (0, node_test_1.it)('다른 결제 대행사 이름으로 오면 거절한다', async () => {
        const controller = new payment_callback_controller_1.PaymentCallbackController({}, new payment_provider_1.MockPaymentProvider());
        const body = '{}';
        await strict_1.default.rejects(controller.receive('other-pg', callbackRequest(body, sign(body))), (err) => err instanceof problem_exception_1.ProblemException && err.getStatus() === 403);
    });
    (0, node_test_1.it)('콜백 본문의 상태를 믿지 않고 PG 에 다시 물어 정한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        // 이 거래는 PG 가 FAIL 로 답한다. 콜백은 "성공" 이라고 주장한다.
        const { id, txId } = await seedPayment(appId, {
            status: 'PENDING',
            txId: `MOCK-FAIL${(0, node_crypto_1.randomUUID)().slice(0, 8)}`,
        });
        const controller = new payment_callback_controller_1.PaymentCallbackController(realService(), new payment_provider_1.MockPaymentProvider());
        const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${(0, node_crypto_1.randomUUID)()}`, status: 'CONFIRMED' });
        const res = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
        strict_1.default.deepEqual(res, { received: true, outcome: 'VERIFIED' });
        strict_1.default.equal(await statusOf(id), 'FAILED', '콜백이 CONFIRMED 라고 해도 PG 답이 FAILED 면 FAILED');
    });
    (0, node_test_1.it)('같은 콜백은 한 번만 처리한다 — PG 재조회도 한 번', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        const { id, txId } = await seedPayment(appId, { status: 'PENDING' });
        const controller = new payment_callback_controller_1.PaymentCallbackController(realService(), new payment_provider_1.MockPaymentProvider());
        const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${(0, node_crypto_1.randomUUID)()}` });
        const first = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
        const again = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
        strict_1.default.equal(first.outcome, 'VERIFIED');
        strict_1.default.equal(again.outcome, 'DUPLICATE');
        strict_1.default.equal(await statusOf(id), 'CONFIRMED');
        strict_1.default.deepEqual(await events(id), ['CALLBACK_RECEIVED', 'VERIFY_CONFIRMED'], 'PG 재조회는 한 번');
    });
    (0, node_test_1.it)('우리가 모르는 거래도 200 으로 받는다 — 오류를 주면 PG 가 계속 다시 보낸다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const controller = new payment_callback_controller_1.PaymentCallbackController(realService(), new payment_provider_1.MockPaymentProvider());
        const body = JSON.stringify({ providerTxId: 'MOCK-NOT-OURS', eventId: 'evt-x' });
        const res = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
        strict_1.default.deepEqual(res, { received: true, outcome: 'UNKNOWN_TX' });
    });
});
(0, node_test_1.describe)('결제 재확인 워커 (D-40)', () => {
    (0, node_test_1.it)('PENDING·UNKNOWN 만 묻고, CREATED·확정된 결제는 묻지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        // 첫 확인은 만든 지 30초 뒤다. 방금 만든 결제는 지원자 화면이 아직 묻고 있다.
        const aMinute = { createdAgo: '1 minute' };
        const pending = await seedPayment(appId, { status: 'PENDING', ...aMinute });
        const unknown = await seedPayment(appId, { status: 'UNKNOWN', ...aMinute });
        const created = await seedPayment(appId, { status: 'CREATED', ...aMinute });
        const confirmed = await seedPayment(appId, { status: 'CONFIRMED', ...aMinute });
        const failed = await seedPayment(appId, { status: 'FAILED', ...aMinute });
        const fresh = await seedPayment(appId, { status: 'PENDING' });
        const { service, asked } = recordingService();
        const worker = new payment_recheck_worker_1.PaymentRecheckWorker(db, service, new dependency_breakers_1.DependencyBreakers());
        const res = await worker.tick({ batchSize: 1000 });
        strict_1.default.equal(res.skipped, null);
        strict_1.default.ok(asked.includes(pending.id));
        strict_1.default.ok(asked.includes(unknown.id));
        for (const p of [created, confirmed, failed])
            strict_1.default.ok(!asked.includes(p.id));
        strict_1.default.ok(!asked.includes(fresh.id), '방금 만든 결제는 30초를 기다린다');
    });
    (0, node_test_1.it)('확인할수록 간격이 늘어난다 (30초 × 2^(n−1), 최대 30분)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        // 한 번 물었고 40초 지났다 → 간격 30초 → 차례
        const once = await seedPayment(appId, { status: 'PENDING', verifiedAgo: '40 seconds' });
        await addVerifyEvents(once.id, 1);
        // 세 번 물었고 90초 지났다 → 간격 120초 → 아직
        const thrice = await seedPayment(appId, { status: 'PENDING', verifiedAgo: '90 seconds' });
        await addVerifyEvents(thrice.id, 3);
        // 스무 번 물었고 29분 지났다 → 간격 30분(상한) → 아직
        const many = await seedPayment(appId, { status: 'UNKNOWN', verifiedAgo: '29 minutes' });
        await addVerifyEvents(many.id, 20);
        // 스무 번 물었고 31분 지났다 → 차례
        const manyDue = await seedPayment(appId, { status: 'UNKNOWN', verifiedAgo: '31 minutes' });
        await addVerifyEvents(manyDue.id, 20);
        const { service, asked } = recordingService();
        await new payment_recheck_worker_1.PaymentRecheckWorker(db, service, new dependency_breakers_1.DependencyBreakers()).tick({ batchSize: 1000 });
        strict_1.default.ok(asked.includes(once.id));
        strict_1.default.ok(!asked.includes(thrice.id));
        strict_1.default.ok(!asked.includes(many.id));
        strict_1.default.ok(asked.includes(manyDue.id));
    });
    (0, node_test_1.it)('기한이 지난 결제는 더 묻지 않는다 — 대조가 사람에게 넘긴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        const old = await seedPayment(appId, { status: 'UNKNOWN', createdAgo: '49 hours' });
        const { service, asked } = recordingService();
        await new payment_recheck_worker_1.PaymentRecheckWorker(db, service, new dependency_breakers_1.DependencyBreakers()).tick({ batchSize: 1000, maxAgeHours: 48 });
        strict_1.default.ok(!asked.includes(old.id));
    });
    (0, node_test_1.it)('PG 회로가 열려 있으면 이번 주기를 건너뛴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const breakers = new dependency_breakers_1.DependencyBreakers();
        for (let i = 0; i < 100 && breakers.paymentGateway.state !== 'OPEN'; i += 1) {
            await breakers.paymentGateway.run(() => Promise.reject(new Error('down'))).catch(() => undefined);
        }
        strict_1.default.equal(breakers.paymentGateway.state, 'OPEN');
        const { service, asked } = recordingService();
        const res = await new payment_recheck_worker_1.PaymentRecheckWorker(db, service, breakers).tick();
        strict_1.default.equal(res.skipped, 'CIRCUIT_OPEN');
        strict_1.default.equal(asked.length, 0);
    });
    (0, node_test_1.it)('다른 Pod 가 돌고 있으면 건너뛴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const release = await holdLock(payment_recheck_worker_1.PaymentRecheckWorker.LOCK);
        try {
            const { service, asked } = recordingService();
            const res = await new payment_recheck_worker_1.PaymentRecheckWorker(db, service, new dependency_breakers_1.DependencyBreakers()).tick();
            strict_1.default.equal(res.skipped, 'LOCKED');
            strict_1.default.equal(asked.length, 0);
        }
        finally {
            await release();
        }
    });
    (0, node_test_1.it)('실제 PG 로: 결제 직후 창을 닫아도 워커가 결제 확인을 끝낸다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seedApplication();
        // 지원자 화면이 한 번 물었을 때는 아직 PENDING 이었다 (Mock SLOW).
        const { id } = await seedPayment(appId, {
            status: 'PENDING',
            txId: `MOCK-SLOW${(0, node_crypto_1.randomUUID)().slice(0, 8)}`,
            verifiedAgo: '40 seconds',
        });
        await addVerifyEvents(id, 1);
        const provider = new payment_provider_1.MockPaymentProvider();
        await provider.verify((await db.query(`SELECT provider_tx_id FROM payment WHERE id = $1`, [id])).rows[0].provider_tx_id);
        // 이 결제만 확인하게 워커의 서비스를 감싼다 — 다른 시험 파일의 결제를 PG 에 묻지 않는다.
        const real = new payment_service_1.PaymentService(db, provider, new audit_service_1.AuditService(), new dependency_breakers_1.DependencyBreakers());
        const scoped = {
            verify: (pid) => (pid === id ? real.verify(pid) : Promise.resolve({ id: pid, status: 'PENDING' })),
        };
        const res = await new payment_recheck_worker_1.PaymentRecheckWorker(db, scoped, new dependency_breakers_1.DependencyBreakers()).tick({ batchSize: 1000 });
        strict_1.default.ok(res.confirmed >= 1);
        strict_1.default.equal(await statusOf(id), 'CONFIRMED');
    });
});
(0, node_test_1.describe)('대조 스케줄 (D-40)', () => {
    (0, node_test_1.it)('Peak Mode 예약 시각부터 비핵심 대조를 실행하지 않는다', async () => {
        let runs = 0;
        const reconciliation = {
            async reconcile() {
                runs += 1;
                return { checked: 0, opened: 0, autoResolved: 0, stillOpen: 0 };
            },
        };
        const scheduler = new reconciliation_scheduler_1.ReconciliationScheduler(db, reconciliation, {
            enabled: false,
            scheduledActivationMs: Date.parse('2026-09-11T03:00:00Z'),
            suspendNonCriticalJobs: true,
        });
        strict_1.default.equal(await scheduler.tick(48), null);
        strict_1.default.equal(runs, 0);
    });
    (0, node_test_1.it)('한 Pod 만 대조를 돌린다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        let runs = 0;
        const reconciliation = {
            async reconcile(sinceHours) {
                runs += 1;
                strict_1.default.equal(sinceHours, 48);
                return { checked: 0, opened: 0, autoResolved: 0, stillOpen: 0 };
            },
        };
        const scheduler = new reconciliation_scheduler_1.ReconciliationScheduler(db, reconciliation);
        const release = await holdLock(reconciliation_scheduler_1.ReconciliationScheduler.LOCK);
        try {
            strict_1.default.equal(await scheduler.tick(48), null, '다른 Pod 가 쥐고 있으면 돌지 않는다');
        }
        finally {
            await release();
        }
        strict_1.default.equal(runs, 0);
        strict_1.default.deepEqual(await scheduler.tick(48), { checked: 0, opened: 0, autoResolved: 0, stillOpen: 0 });
        strict_1.default.equal(runs, 1);
        // 끝나면 잠금을 놓는다 — 다음 주기에 다시 잡을 수 있어야 한다.
        strict_1.default.notEqual(await scheduler.tick(48), null);
    });
});
//# sourceMappingURL=payment-reconcile.integration.test.js.map