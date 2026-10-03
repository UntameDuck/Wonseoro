"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const ownership_service_1 = require("./ownership.service");
const activation_recorder_1 = require("../../modules/activation/activation-recorder");
const activation_signer_1 = require("../../modules/activation/activation-signer");
const audit_service_1 = require("../../modules/audit/audit.service");
const deadline_policy_repository_1 = require("../../modules/deadline/deadline-policy.repository");
const deadline_service_1 = require("../../modules/deadline/deadline.service");
const self_check_controller_1 = require("../../modules/meta/self-check.controller");
/**
 * 소유권 확인 통합 테스트 — 실제 PostgreSQL 이 필요하다.
 *
 * 여기서 확인하는 것은 "남의 원서에 손댈 수 있는가" 하나다.
 * 원서 식별자는 URL 에 드러나므로, 그것만으로 접근이 되면 접수 시스템이 아니다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db;
let available = false;
let owner;
let stranger;
let applicationId;
let paymentId;
let documentId;
let submissionId;
const ownership = () => new ownership_service_1.Ownership(db);
async function seedApplicant() {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`, [id, `subj-own-${id.slice(0, 8)}`]);
    return id;
}
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    owner = await seedApplicant();
    stranger = await seedApplicant();
    applicationId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'FINALIZED')`, [applicationId, CYCLE, owner, TYPE, DEPT]);
    paymentId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,'CONFIRMED',now())`, [paymentId, applicationId, `TX-${paymentId.slice(0, 12)}`]);
    documentId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO document
       (id, application_id, document_type, object_key, original_filename,
        media_type, size_bytes, sha256_hex, status)
     VALUES ($1,$2,'TRANSCRIPT',$3,'a.pdf','application/pdf',1024,$4,'AVAILABLE')`, [documentId, applicationId, `docs/${documentId}`, 'a'.repeat(64)]);
    submissionId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO submission (id, application_id, application_number, requested_at,
                             payment_verified_at, finalized_at, deadline_policy_version,
                             config_version, evidence_hash)
     VALUES ($1,$2,$3,now(),now(),now(),'p-v1','c-v1','h')`, [submissionId, applicationId, `OWN-${submissionId.slice(0, 12)}`]);
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await db.query(`DELETE FROM submission WHERE id = $1`, [submissionId]);
    await db.query(`DELETE FROM document WHERE id = $1`, [documentId]);
    await db.query(`DELETE FROM payment WHERE id = $1`, [paymentId]);
    await db.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
    await db.query(`DELETE FROM applicant WHERE id = $1 OR id = $2`, [owner, stranger]);
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('원서 소유권 (v1.0 §8.3 / v1.1 §09)', () => {
    (0, node_test_1.it)('본인 원서는 통과한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.doesNotReject(ownership().assertApplication(applicationId, owner));
    });
    (0, node_test_1.it)('남의 원서는 막는다 — 식별자를 안다고 자기소개서를 열람할 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.rejects(ownership().assertApplication(applicationId, stranger));
    });
    (0, node_test_1.it)('없는 원서와 남의 원서를 같은 오류로 돌려준다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        // 구분해 주면 "이 식별자는 존재한다"를 알려주는 셈이라 훑어서 찾아낼 수 있다.
        const notMine = await problemOf(ownership().assertApplication(applicationId, stranger));
        const notThere = await problemOf(ownership().assertApplication((0, node_crypto_1.randomUUID)(), stranger));
        strict_1.default.equal(notMine.status, notThere.status);
        strict_1.default.equal(notMine.detail, notThere.detail);
    });
});
(0, node_test_1.describe)('딸린 자원의 소유권', () => {
    (0, node_test_1.it)('결제는 원서를 통해 판정한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.doesNotReject(ownership().assertPayment(paymentId, owner));
        // 남의 결제를 재검증할 수 있으면 상태를 임의로 움직일 수 있다.
        await strict_1.default.rejects(ownership().assertPayment(paymentId, stranger));
    });
    (0, node_test_1.it)('서류도 마찬가지다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.doesNotReject(ownership().assertDocument(documentId, owner));
        // 남의 서류를 지울 수 있으면 마감 직전에 원서를 무력화할 수 있다.
        await strict_1.default.rejects(ownership().assertDocument(documentId, stranger));
    });
    (0, node_test_1.it)('접수증도 마찬가지다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.doesNotReject(ownership().assertSubmission(submissionId, owner));
        await strict_1.default.rejects(ownership().assertSubmission(submissionId, stranger));
    });
});
(0, node_test_1.describe)('Self-check 도 본인 원서만 (D-28 에서 빠졌던 경로)', () => {
    const controller = () => new self_check_controller_1.SelfCheckController(db, new deadline_service_1.DeadlineService(new deadline_policy_repository_1.DeadlinePolicyRepository(db, new activation_recorder_1.ActivationRecorder(db, new activation_signer_1.ActivationSigner(), new audit_service_1.AuditService()))), ownership());
    const as = (applicantId) => ({ headers: { 'x-applicant-id': applicantId } });
    (0, node_test_1.it)('본인은 접수번호와 상태를 본다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const res = await controller().selfCheck(applicationId, as(owner));
        strict_1.default.equal(res.submission?.submissionId, submissionId);
    });
    (0, node_test_1.it)('남은 볼 수 없다 — 없는 원서와 같은 404 로', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const notMine = await problemOf(controller().selfCheck(applicationId, as(stranger)));
        const notThere = await problemOf(controller().selfCheck((0, node_crypto_1.randomUUID)(), as(stranger)));
        strict_1.default.equal(notMine.status, 404);
        strict_1.default.equal(notMine.status, notThere.status);
        strict_1.default.equal(notMine.detail, notThere.detail);
    });
});
async function problemOf(p) {
    try {
        await p;
        strict_1.default.fail('거부되어야 한다');
    }
    catch (err) {
        return err.problem;
    }
}
//# sourceMappingURL=ownership.integration.test.js.map