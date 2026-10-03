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
const break_glass_1 = require("../../test-support/break-glass");
const activation_recorder_1 = require("../activation/activation-recorder");
const activation_signer_1 = require("../activation/activation-signer");
const audit_service_1 = require("../audit/audit.service");
const form_schema_service_1 = require("../config/form-schema.service");
const deadline_policy_repository_1 = require("../deadline/deadline-policy.repository");
const deadline_service_1 = require("../deadline/deadline.service");
const payment_callback_controller_1 = require("../payment/payment-callback.controller");
const payment_provider_1 = require("../payment/payment.provider");
const payment_service_1 = require("../payment/payment.service");
const finalization_service_1 = require("./finalization.service");
/**
 * 결제 = 접수 (D-42) — 실제 PostgreSQL 이 필요하다.
 *
 * 현행 원서접수는 전형료 결제를 마치면 접수가 끝난다. 결제 후 창을 닫은 지원자의 원서가
 * PAID 로 마감을 넘기면 "돈은 냈는데 접수는 안 된" 분쟁이 된다.
 *
 * 개발 시드의 2027 수시 · EARLY 전형을 쓴다 (활성 마감 정책 · 추가문항 3개, 필수 서류 없음).
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const COMPLETE = { highSchool: '원서고등학교', graduationYear: 2026, selfIntro: '열 글자를 넘는 자기소개입니다.' };
let db;
let available = false;
const apps = [];
const applicants = [];
/** 서비스 묶음. 모듈이 기동할 때처럼 onModuleInit 으로 결제 훅을 건다. */
function wire() {
    const audit = new audit_service_1.AuditService();
    const payments = new payment_service_1.PaymentService(db, new payment_provider_1.MockPaymentProvider(), audit, new dependency_breakers_1.DependencyBreakers());
    const recorder = new activation_recorder_1.ActivationRecorder(db, new activation_signer_1.ActivationSigner(), audit);
    const finalization = new finalization_service_1.FinalizationService(db, payments, new deadline_service_1.DeadlineService(new deadline_policy_repository_1.DeadlinePolicyRepository(db, recorder)), new form_schema_service_1.FormSchemaService(db), audit);
    finalization.onModuleInit();
    return { payments, finalization };
}
async function seedApplication(opts = {}) {
    const id = (0, node_crypto_1.randomUUID)();
    const applicantId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`, [applicantId, `subj-auto-${applicantId.slice(0, 8)}`]);
    applicants.push(applicantId);
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`, [id, CYCLE, applicantId, TYPE, DEPT, opts.status ?? 'DRAFT']);
    apps.push(id);
    for (const [code, value] of Object.entries(opts.fields ?? COMPLETE)) {
        await db.query(`INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json)
       VALUES ($1,$2,$3,'test',$4)`, [(0, node_crypto_1.randomUUID)(), id, code, JSON.stringify(value)]);
    }
    return { id, applicantId };
}
async function seedPendingPayment(appId) {
    const id = (0, node_crypto_1.randomUUID)();
    const txId = `MOCK-AF${(0, node_crypto_1.randomUUID)().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
     VALUES ($1,$2,'mock-pg',$3,55000,'PENDING')`, [id, appId, txId]);
    return { id, txId };
}
async function submissionOf(appId) {
    const { rows } = await db.query(`SELECT requested_at, application_number FROM submission WHERE application_id = $1`, [appId]);
    return rows;
}
async function statusOf(appId) {
    const { rows } = await db.query(`SELECT status FROM application WHERE id = $1`, [appId]);
    return rows[0].status;
}
async function audits(appId, action) {
    const { rows } = await db.query(`SELECT actor_type, actor_id, result, details_redacted FROM audit_event
      WHERE application_id = $1 AND action = $2 ORDER BY occurred_at`, [appId, action]);
    return rows;
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
    await (0, break_glass_1.breakGlass)(async (c) => {
        await c.query(`SELECT id FROM application WHERE id = ANY($1) FOR UPDATE`, [apps]);
        await c.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM outbox_event WHERE aggregate_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM submission WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`, [apps]);
        await c.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM application_field_value WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM application WHERE id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('결제 = 접수 (D-42)', () => {
    (0, node_test_1.it)('결제가 확인되면 서버가 접수한다 — 지원자가 창을 닫아도', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id: appId, applicantId } = await seedApplication();
        const { payment } = await payments.createIntent(appId, applicantId, {});
        await payments.verify(payment.id);
        const subs = await submissionOf(appId);
        strict_1.default.equal(subs.length, 1);
        strict_1.default.equal(await statusOf(appId), 'FINALIZED');
        // 제출 의사를 밝힌 시각은 "결제하기" 로 결제 의도를 만든 시각이다.
        const { rows } = await db.query(`SELECT created_at FROM payment WHERE id = $1`, [payment.id]);
        strict_1.default.equal(subs[0].requested_at.getTime(), rows[0].created_at.getTime());
        const [finalized] = await audits(appId, 'APPLICATION_FINALIZED');
        strict_1.default.equal(finalized.actor_type, 'SYSTEM');
        strict_1.default.equal(finalized.details_redacted.trigger, 'PAYMENT_CONFIRMED');
    });
    (0, node_test_1.it)('접수할 수 없는 원서는 결제창을 열지 않는다 — 돈을 받은 뒤에 알리면 환불 사건이 된다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { selfIntro: _missing, ...partial } = COMPLETE;
        const { id: appId, applicantId } = await seedApplication({ fields: partial });
        await strict_1.default.rejects(payments.createIntent(appId, applicantId, {}), (err) => err instanceof problem_exception_1.ProblemException && err.getStatus() === 422);
        const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [appId]);
        strict_1.default.equal(rows.length, 0, '결제 기록이 생기지 않는다');
    });
    (0, node_test_1.it)('PG 콜백으로 확인돼도 접수된다 — 화면이 verify 를 부르지 않은 경우', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id: appId } = await seedApplication();
        const { txId } = await seedPendingPayment(appId);
        const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${(0, node_crypto_1.randomUUID)()}` });
        const signature = (0, node_crypto_1.createHmac)('sha256', config_1.PG_CALLBACK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
        const controller = new payment_callback_controller_1.PaymentCallbackController(payments, new payment_provider_1.MockPaymentProvider());
        await controller.receive('mock-pg', {
            headers: { 'x-pg-signature': signature },
            rawBody: Buffer.from(body, 'utf8'),
            ip: '127.0.0.1',
        });
        strict_1.default.equal((await submissionOf(appId)).length, 1);
    });
    (0, node_test_1.it)('결제가 늦게 확인되는 사이 취소한 원서는 접수하지 않는다 — 그 결제는 환불 대상이다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id: appId } = await seedApplication({ status: 'CANCELLED' });
        const { id: paymentId } = await seedPendingPayment(appId);
        const verified = await payments.verify(paymentId);
        strict_1.default.equal(verified.status, 'CONFIRMED', '결제 확인 자체는 되돌리지 않는다');
        strict_1.default.equal((await submissionOf(appId)).length, 0);
        strict_1.default.equal(await statusOf(appId), 'CANCELLED');
        const [rejected] = await audits(appId, 'FINALIZE_REQUESTED');
        strict_1.default.equal(rejected.result, 'REJECTED');
        strict_1.default.equal(rejected.details_redacted.code, 'ILLEGAL_TRANSITION');
    });
    (0, node_test_1.it)('자동 접수와 화면 제출이 겹쳐도 접수는 한 건이고, 둘 다 성공으로 답한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments, finalization } = wire();
        const { id: appId, applicantId } = await seedApplication();
        const { id: paymentId } = await seedPendingPayment(appId);
        const [, byApplicant] = await Promise.all([
            payments.verify(paymentId),
            // 결제 확인과 경합하도록 조금 늦게 제출한다. 결제가 아직이면 409 가 정상이다.
            new Promise((r) => setTimeout(r, 5)).then(() => finalization
                .finalize({ applicationId: appId, applicantId, requestedAt: new Date() })
                .catch((err) => err)),
        ]);
        strict_1.default.equal((await submissionOf(appId)).length, 1);
        if (byApplicant instanceof problem_exception_1.ProblemException) {
            strict_1.default.equal(byApplicant.problem.code, 'PAYMENT_NOT_CONFIRMED', `예상 밖 오류: ${byApplicant.problem.code}`);
        }
        else {
            strict_1.default.ok(byApplicant && typeof byApplicant === 'object' && 'submission' in byApplicant);
        }
        // 한 번 더 제출해도 같은 접수를 돌려준다.
        const again = await finalization.finalize({ applicationId: appId, applicantId, requestedAt: new Date() });
        strict_1.default.equal(again.created, false);
    });
});
//# sourceMappingURL=auto-finalize.integration.test.js.map