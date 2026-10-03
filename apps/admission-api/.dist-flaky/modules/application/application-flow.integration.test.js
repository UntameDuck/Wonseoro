"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const postgres_idempotency_store_1 = require("../../common/idempotency/postgres-idempotency.store");
const problem_exception_1 = require("../../common/problem/problem.exception");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const server_clock_1 = require("../../common/time/server-clock");
const break_glass_1 = require("../../test-support/break-glass");
const activation_recorder_1 = require("../activation/activation-recorder");
const activation_signer_1 = require("../activation/activation-signer");
const audit_service_1 = require("../audit/audit.service");
const form_schema_service_1 = require("../config/form-schema.service");
const deadline_policy_repository_1 = require("../deadline/deadline-policy.repository");
const deadline_service_1 = require("../deadline/deadline.service");
const document_service_1 = require("../document/document.service");
const file_inspector_1 = require("../document/file-inspector");
const object_storage_1 = require("../document/object-storage");
const finalization_service_1 = require("../finalization/finalization.service");
const payment_provider_1 = require("../payment/payment.provider");
const payment_service_1 = require("../payment/payment.service");
const reconciliation_service_1 = require("../reconciliation/reconciliation.service");
const application_state_service_1 = require("./application-state.service");
const application_repository_1 = require("./application.repository");
const profile_vault_client_1 = require("./profile-vault.client");
/**
 * 원서 흐름 전체 — 상태머신·결제·서류·시각이 서로 이어지는가 (D-55 · §A2 · §A9 · §B4)
 *
 * 각 부분은 따로 시험되고 있었지만 **서로 연결되지 않은 곳**이 있었다. 원서 상태는 DRAFT 에서
 * 바로 FINALIZED 로 갔고(READY·PAYMENT_PENDING·PAID 가 쓰이지 않았다), 한 원서에 결제창을 몇 개든
 * 열 수 있었고, 결제를 시작한 원서를 고칠 수 있었고, 접수 기록의 clock offset 은 늘 0 이었다.
 *
 * 개발 시드의 2027 수시 · EARLY 전형을 쓴다 (활성 마감 정책 · 추가문항 · 선택 서류 TRANSCRIPT).
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const COMPLETE = { highSchool: '원서고등학교', graduationYear: 2026, selfIntro: '열 글자를 넘는 자기소개입니다.' };
let db;
let available = false;
const apps = [];
const applicants = [];
const extraDepartments = [];
/** 정산 목록을 시험이 정하는 PG. 나머지는 Mock 과 같다. */
class LedgerPg extends payment_provider_1.MockPaymentProvider {
    ledger = null;
    async reconcile(from, to) {
        return this.ledger ?? super.reconcile(from, to);
    }
}
/** 모듈이 기동할 때처럼 서비스를 잇는다. `autoFinalize: false` 면 결제 확정 뒤 접수 훅을 걸지 않는다. */
function wire(opts = {}) {
    const audit = new audit_service_1.AuditService();
    const forms = new form_schema_service_1.FormSchemaService(db);
    const breakers = new dependency_breakers_1.DependencyBreakers();
    const provider = new LedgerPg();
    const payments = new payment_service_1.PaymentService(db, provider, audit, breakers);
    const recorder = new activation_recorder_1.ActivationRecorder(db, new activation_signer_1.ActivationSigner(), audit);
    const deadline = new deadline_service_1.DeadlineService(new deadline_policy_repository_1.DeadlinePolicyRepository(db, recorder));
    const finalization = new finalization_service_1.FinalizationService(db, payments, deadline, forms, audit);
    if (opts.autoFinalize !== false)
        finalization.onModuleInit();
    const repo = new application_repository_1.ApplicationRepository(db, audit, new application_state_service_1.ApplicationStateService(), new profile_vault_client_1.ProfileVaultClient(breakers));
    const documents = new document_service_1.DocumentService(db, new object_storage_1.ObjectStorage(), new file_inspector_1.FileInspector(), audit, forms);
    const reconciliation = new reconciliation_service_1.ReconciliationService(db, audit, provider, payments, breakers);
    return { payments, finalization, repo, documents, reconciliation, provider };
}
async function seedApplicant() {
    const applicantId = (0, node_crypto_1.randomUUID)();
    const subjectToken = `subj-flow-${applicantId.slice(0, 8)}`;
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1,$2,'\\x00','v1')`, [applicantId, subjectToken]);
    applicants.push(applicantId);
    return { applicantId, subjectToken };
}
async function seedApplication(opts = {}) {
    const { applicantId } = await seedApplicant();
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`, [id, CYCLE, applicantId, TYPE, DEPT, opts.status ?? 'DRAFT']);
    apps.push(id);
    for (const [code, value] of Object.entries(opts.fields ?? COMPLETE)) {
        await db.query(`INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json)
       VALUES ($1,$2,$3,'test',$4)`, [(0, node_crypto_1.randomUUID)(), id, code, JSON.stringify(value)]);
    }
    return { id, applicantId };
}
async function seedPayment(appId, status, txId = `MOCK-FL${(0, node_crypto_1.randomUUID)().slice(0, 12).toUpperCase()}`) {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,$4::varchar, CASE WHEN $4::varchar = 'CONFIRMED' THEN now() END)`, [id, appId, txId, status]);
    return { id, txId };
}
async function row(appId) {
    const { rows } = await db.query(`SELECT status, version FROM application WHERE id = $1`, [appId]);
    return rows[0];
}
async function audits(appId, action) {
    const { rows } = await db.query(`SELECT actor_type, result, details_redacted FROM audit_event
      WHERE application_id = $1 AND action = $2 ORDER BY occurred_at`, [appId, action]);
    return rows;
}
const problem = (status, code) => (err) => err instanceof problem_exception_1.ProblemException && err.getStatus() === status && (!code || err.problem.code === code);
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
});
(0, node_test_1.afterEach)(() => server_clock_1.serverClock.reset());
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await (0, break_glass_1.breakGlass)(async (c) => {
        await c.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM outbox_event WHERE aggregate_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM submission WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM idempotency_record WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`, [apps]);
        await c.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM document_scan WHERE document_id IN (SELECT id FROM document WHERE application_id = ANY($1))`, [apps]);
        await c.query(`DELETE FROM document WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM consent_record WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM application_field_value WHERE application_id = ANY($1)`, [apps]);
        await c.query(`DELETE FROM application WHERE id = ANY($1) OR applicant_id = ANY($2)`, [apps, applicants]);
        await c.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
        await c.query(`DELETE FROM department WHERE id = ANY($1)`, [extraDepartments]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('원서 상태머신이 실제 흐름에 연결된다 (D-55)', () => {
    (0, node_test_1.it)('최종 검증을 통과하면 READY, 다시 저장하면 DRAFT — 내용이 바뀌면 다시 검증해야 한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { repo } = wire();
        const { id } = await seedApplication();
        const ready = await repo.markValidated(id, true);
        strict_1.default.equal(ready?.status, 'READY');
        const before = await row(id);
        const saved = await repo.patch({
            applicationId: id,
            expectedVersion: BigInt(before.version),
            fields: { selfIntro: '고쳐 쓴 자기소개입니다. 열 글자 이상.' },
            schemaVersion: 'test',
        });
        strict_1.default.equal(saved.status, 'DRAFT');
        strict_1.default.equal(Number(saved.version), Number(before.version) + 1, '상태와 내용을 한 번에 바꿔 버전은 한 번만 오른다');
    });
    (0, node_test_1.it)('결제를 시작하면 PAYMENT_PENDING — 그 뒤로는 원서를 고칠 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments, repo } = wire();
        const { id, applicantId } = await seedApplication();
        await payments.createIntent(id, applicantId, {});
        const current = await row(id);
        strict_1.default.equal(current.status, 'PAYMENT_PENDING');
        await strict_1.default.rejects(repo.patch({ applicationId: id, expectedVersion: BigInt(current.version), fields: { selfIntro: '' }, schemaVersion: 't' }), problem(409, 'VERSION_CONFLICT'));
    });
    (0, node_test_1.it)('결제가 확정되면 PAID — 접수는 그 다음이다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire({ autoFinalize: false });
        const { id, applicantId } = await seedApplication();
        const { payment } = await payments.createIntent(id, applicantId, {});
        await payments.verify(payment.id);
        strict_1.default.equal((await row(id)).status, 'PAID');
    });
    (0, node_test_1.it)('결제가 실패하면 READY 로 돌아가고 새 결제를 만들 수 있다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id, applicantId } = await seedApplication();
        const first = await payments.createIntent(id, applicantId, {});
        process.env.MOCK_PG_BEHAVIOUR = 'FAIL';
        try {
            strict_1.default.equal((await payments.verify(first.payment.id)).status, 'FAILED');
        }
        finally {
            delete process.env.MOCK_PG_BEHAVIOUR;
        }
        strict_1.default.equal((await row(id)).status, 'READY');
        const second = await payments.createIntent(id, applicantId, {});
        strict_1.default.equal(second.created, true);
        strict_1.default.notEqual(second.payment.id, first.payment.id);
    });
});
(0, node_test_1.describe)('한 원서에 살아 있는 결제는 하나다 (§B4)', () => {
    (0, node_test_1.it)('결제하기를 다시 누르면 새 결제창이 아니라 같은 결제창을 연다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id, applicantId } = await seedApplication();
        const first = await payments.createIntent(id, applicantId, {});
        const again = await payments.createIntent(id, applicantId, {});
        strict_1.default.equal(first.created, true);
        strict_1.default.equal(again.created, false);
        strict_1.default.equal(again.payment.id, first.payment.id);
        strict_1.default.equal(again.providerPayload.providerTxId, first.payment.providerTxId);
        const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [id]);
        strict_1.default.equal(rows.length, 1, '결제 기록은 하나다');
    });
    (0, node_test_1.it)('동시에 눌러도 결제는 하나만 생긴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id, applicantId } = await seedApplication();
        const results = await Promise.all(Array.from({ length: 5 }, () => payments.createIntent(id, applicantId, {})));
        strict_1.default.equal(new Set(results.map((r) => r.payment.id)).size, 1);
        strict_1.default.equal(results.filter((r) => r.created).length, 1);
    });
    (0, node_test_1.it)('확인 중인 결제가 있으면 새 결제를 만들지 않는다 — 다시 결제하면 이중 결제가 된다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id, applicantId } = await seedApplication({ status: 'PAYMENT_PENDING' });
        await seedPayment(id, 'UNKNOWN');
        await strict_1.default.rejects(payments.createIntent(id, applicantId, {}), problem(409, 'PAYMENT_IN_PROGRESS'));
    });
});
(0, node_test_1.describe)('접수 시각은 DB 시계, 어긋난 노드는 접수를 확정하지 않는다 (§A2·§A9)', () => {
    (0, node_test_1.it)('접수 기록과 감사에 이 노드의 clock offset 이 남는다 — 전에는 늘 0 이었다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments } = wire();
        const { id, applicantId } = await seedApplication();
        server_clock_1.serverClock.record({ offsetMs: 37, uncertaintyMs: 2, dbTimeMs: Date.now() - 37 });
        const { payment } = await payments.createIntent(id, applicantId, {});
        await payments.verify(payment.id);
        strict_1.default.equal((await row(id)).status, 'FINALIZED');
        const { rows } = await db.query(`SELECT server_clock_offset_ms FROM submission WHERE application_id = $1`, [id]);
        strict_1.default.equal(rows[0]?.server_clock_offset_ms, 37);
        const [finalized] = await audits(id, 'APPLICATION_FINALIZED');
        strict_1.default.deepEqual(finalized?.details_redacted.clock, { offsetMs: 37, uncertaintyMs: 2, status: 'SYNCED', source: 'db' });
    });
    (0, node_test_1.it)('DB 시계와 1초 넘게 어긋난 노드는 503 — 다른 Pod 가 받는다. 거절도 기록한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { finalization } = wire();
        const { id, applicantId } = await seedApplication({ status: 'PAID' });
        await seedPayment(id, 'CONFIRMED');
        server_clock_1.serverClock.record({ offsetMs: 5_000, uncertaintyMs: 1, dbTimeMs: Date.now() - 5_000 });
        await strict_1.default.rejects(finalization.finalize({ applicationId: id, applicantId, requestedAt: new Date() }), problem(503, 'RETRYABLE'));
        const { rows } = await db.query(`SELECT 1 FROM submission WHERE application_id = $1`, [id]);
        strict_1.default.equal(rows.length, 0);
        const [rejected] = await audits(id, 'FINALIZE_REQUESTED');
        strict_1.default.equal(rejected?.result, 'REJECTED');
        strict_1.default.equal(rejected?.details_redacted.code, 'RETRYABLE');
    });
    (0, node_test_1.it)('ClockMonitor 가 이 DB 와의 offset 을 잰다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const reading = await new server_clock_1.ClockMonitor(db).sample();
        strict_1.default.notEqual(reading.status, 'UNMEASURED');
        strict_1.default.ok(reading.uncertaintyMs !== null && reading.uncertaintyMs >= 0);
        // 같은 PC 의 DB 다(축소 환경). 몇 초씩 어긋나 있지 않다.
        strict_1.default.ok(Math.abs(reading.offsetMs) < 5_000, `offset ${reading.offsetMs}ms`);
    });
});
(0, node_test_1.describe)('거절된 접수 요청도 기록한다 (§A2 · v1.0 §9)', () => {
    (0, node_test_1.it)('지원자가 누른 접수가 결제 미확인으로 거절되면 FINALIZE_REQUESTED REJECTED', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { finalization } = wire();
        const { id, applicantId } = await seedApplication();
        await strict_1.default.rejects(finalization.finalize({ applicationId: id, applicantId, requestedAt: new Date() }), problem(409, 'PAYMENT_NOT_CONFIRMED'));
        const [rejected] = await audits(id, 'FINALIZE_REQUESTED');
        strict_1.default.equal(rejected?.actor_type, 'APPLICANT');
        strict_1.default.equal(rejected?.details_redacted.code, 'PAYMENT_NOT_CONFIRMED');
    });
    (0, node_test_1.it)('접수증을 발급하면 RECEIPT_ISSUED 가 남는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments, finalization } = wire();
        const { id, applicantId } = await seedApplication();
        const { payment } = await payments.createIntent(id, applicantId, {});
        await payments.verify(payment.id);
        const submission = await finalization.findSubmission(id);
        const receipt = await finalization.issueReceipt(submission.submissionId, applicantId);
        strict_1.default.equal(receipt?.applicationNumber, submission?.applicationNumber);
        strict_1.default.equal((await audits(id, 'RECEIPT_ISSUED')).length, 1);
    });
});
(0, node_test_1.describe)('원서 생성·수정의 입력 대조', () => {
    (0, node_test_1.it)('등록된 지원자의 가명 토큰과 다른 토큰을 주장하면 403 — 남의 공통원서를 끌어올 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { repo } = wire();
        const { applicantId } = await seedApplicant();
        await strict_1.default.rejects(repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: DEPT, subjectToken: 'subj-someone-else' }), problem(403));
    });
    (0, node_test_1.it)('등록되지 않은 지원자는 403 — 전에는 외래키 오류로 500 이었다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { repo } = wire();
        await strict_1.default.rejects(repo.create({ cycleId: CYCLE, applicantId: (0, node_crypto_1.randomUUID)(), admissionTypeId: TYPE, departmentId: DEPT }), problem(403));
    });
    (0, node_test_1.it)('모집이 닫힌 모집단위·없는 전형으로는 원서를 만들 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { repo } = wire();
        const { applicantId } = await seedApplicant();
        const closed = (0, node_crypto_1.randomUUID)();
        extraDepartments.push(closed);
        await (0, break_glass_1.breakGlass)((c) => c.query(`INSERT INTO department (id, cycle_id, code, name, quota, active) VALUES ($1,$2,$3,'모집 종료 학과',10,false)`, [closed, CYCLE, `CL-${closed.slice(0, 6)}`]));
        await strict_1.default.rejects(repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: closed }), problem(400, 'VALIDATION_FAILED'));
        await strict_1.default.rejects(repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: (0, node_crypto_1.randomUUID)(), departmentId: DEPT }), problem(400, 'VALIDATION_FAILED'));
    });
});
(0, node_test_1.describe)('서류는 작성 중에만, 전형이 받는 종류만 (§A5 · D-55)', () => {
    (0, node_test_1.it)('결제를 시작한 원서에는 서류를 올릴 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { documents } = wire();
        const { id, applicantId } = await seedApplication({ status: 'PAYMENT_PENDING' });
        await strict_1.default.rejects(documents.createIntent({
            applicationId: id,
            applicantId,
            documentType: 'TRANSCRIPT',
            filename: 'a.pdf',
            mediaType: 'application/pdf',
            sizeBytes: 1024,
        }), problem(409));
    });
    (0, node_test_1.it)('전형 설정에 없는 서류 종류는 받지 않고, 있는 종류는 받는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { documents } = wire();
        const { id, applicantId } = await seedApplication();
        const intent = (documentType) => documents.createIntent({
            applicationId: id,
            applicantId,
            documentType,
            filename: 'a.pdf',
            mediaType: 'application/pdf',
            sizeBytes: 1024,
        });
        await strict_1.default.rejects(intent('AWARD'), problem(400, 'VALIDATION_FAILED'));
        const ok = await intent('TRANSCRIPT');
        strict_1.default.ok(ok.documentId);
    });
});
(0, node_test_1.describe)('PG 정산 대조 (§A4·§B18) — 재확인 워커가 묻지 않는 결제', () => {
    (0, node_test_1.it)('콜백도 화면 확인도 없이 결제창만 연 채로 남은 결제를 PG 장부에서 찾아 접수까지 잇는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { payments, reconciliation } = wire();
        const { id, applicantId } = await seedApplication();
        const { payment } = await payments.createIntent(id, applicantId, {});
        strict_1.default.equal(payment.status, 'CREATED');
        const findings = await reconciliation.detect(1);
        strict_1.default.equal(findings.filter((f) => f.applicationId === id).length, 0);
        strict_1.default.equal((await row(id)).status, 'FINALIZED', '정산 대조가 결제를 확인했고 자동 접수가 이어졌다');
    });
    (0, node_test_1.it)('우리는 확정인데 PG 장부에 승인이 없으면 CRITICAL', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const { reconciliation, provider } = wire();
        const { id } = await seedApplication({ status: 'PAID' });
        const { txId } = await seedPayment(id, 'CONFIRMED');
        provider.ledger = [{ providerTxId: txId, status: 'CANCELLED' }];
        const findings = (await reconciliation.detect(1)).filter((f) => f.applicationId === id);
        // 결제 확정·미접수(1번)도 함께 걸린다 — 이 원서는 둘 다 사실이다.
        strict_1.default.ok(findings.some((f) => f.type === 'PAYMENT_NOT_SETTLED_AT_PG' && f.severity === 'CRITICAL'), JSON.stringify(findings.map((f) => f.type)));
    });
});
(0, node_test_1.describe)('멱등 기록 — 결제·서류 경로와 만료 정리 (D-11)', () => {
    (0, node_test_1.it)('결제·서류 ID 로 원서를 찾아 멱등 기록을 남길 수 있다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const { id } = await seedApplication();
        const { id: paymentId } = await seedPayment(id, 'CREATED');
        strict_1.default.equal(await store.applicationOf({ paymentId }), id);
        strict_1.default.equal(await store.applicationOf({ paymentId: (0, node_crypto_1.randomUUID)() }), null);
        strict_1.default.equal(await store.applicationOf({ documentId: 'not-a-uuid' }), null);
    });
    (0, node_test_1.it)('만료된 기록은 정리되고, 만료되지 않은 기록은 남는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const { id } = await seedApplication();
        await db.query(`INSERT INTO idempotency_record (id, application_id, operation, idempotency_key, request_hash, state, expires_at)
       VALUES ($1,$2,'POST:x','expired-key-000001','h','COMPLETED', now() - interval '1 hour'),
              ($3,$2,'POST:x','fresh-key-00000001','h','COMPLETED', now() + interval '1 hour')`, [(0, node_crypto_1.randomUUID)(), id, (0, node_crypto_1.randomUUID)()]);
        await store.purgeExpired();
        const { rows } = await db.query(`SELECT idempotency_key FROM idempotency_record WHERE application_id = $1`, [id]);
        strict_1.default.deepEqual(rows.map((r) => r.idempotency_key), ['fresh-key-00000001']);
    });
});
//# sourceMappingURL=application-flow.integration.test.js.map