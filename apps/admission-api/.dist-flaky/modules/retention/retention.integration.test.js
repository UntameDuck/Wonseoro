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
const activation_recorder_1 = require("../activation/activation-recorder");
const activation_signer_1 = require("../activation/activation-signer");
const audit_service_1 = require("../audit/audit.service");
const config_version_service_1 = require("../config/config-version.service");
const deadline_policy_repository_1 = require("../deadline/deadline-policy.repository");
const deadline_service_1 = require("../deadline/deadline.service");
const retention_fixture_1 = require("./retention.fixture");
const retention_service_1 = require("./retention.service");
/**
 * 보존정책 → 설정 승인 → 파기 계획 통합 테스트 — 실제 PostgreSQL 이 필요하다. (T-M3-10)
 * 전형은 지우지 않고 닫는다 (적용 기록이 남으므로).
 */
let db;
let available = false;
const cycles = [];
const recorder = () => new activation_recorder_1.ActivationRecorder(db, new activation_signer_1.ActivationSigner(), new audit_service_1.AuditService());
const configs = () => new config_version_service_1.ConfigVersionService(db, new deadline_service_1.DeadlineService(new deadline_policy_repository_1.DeadlinePolicyRepository(db, recorder())), recorder());
/** 이미 마감된 지 오래된 모집. 보존기간이 지난 상태를 만든다. */
async function makeClosedCycle(closedDaysAgo) {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
     VALUES ($1, 'UNIV-A', 2099, $2, now() - ($3 || ' days')::interval - interval '30 days',
             now() - ($3 || ' days')::interval, 'CLOSED')`, [id, `보존 검증용 ${id.slice(0, 8)}`, String(closedDaysAgo)]);
    cycles.push(id);
    return id;
}
async function activate(cycleId, config) {
    const svc = configs();
    const row = await svc.createDraft({ cycleId, version: `ret-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`, config, createdBy: 'privacy1@univ-a' });
    const d1 = await svc.diff(row.id);
    await svc.approve(row.id, 'privacy2@univ-a', d1.digest);
    const d2 = await svc.diff(row.id);
    await svc.approve(row.id, 'privacy3@univ-a', d2.digest);
    await svc.activate(row.id, null, 'privacy2@univ-a');
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
    for (const id of cycles) {
        await db.query(`UPDATE admission_cycle SET status = 'ARCHIVED' WHERE id = $1`, [id]);
    }
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('보존정책은 설정 승인 절차를 탄다 (v1.1 §A15·§A14)', () => {
    (0, node_test_1.it)('법정 기준보다 짧은 보존정책은 초안조차 만들 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const cycleId = await makeClosedCycle(10);
        await strict_1.default.rejects(configs().createDraft({
            cycleId,
            version: 'ret-bad',
            config: { retention: { ...retention_fixture_1.VALID_RETENTION, ADMIN_ACCESS_LOG: { days: 30 } } },
            createdBy: 'privacy1@univ-a',
        }), (err) => err instanceof problem_exception_1.ProblemException &&
            err.getStatus() === 400 &&
            /ADMIN_ACCESS_LOG/.test(String(err.problem.detail)));
    });
    (0, node_test_1.it)('보존정책이 없으면 아무것도 파기 대상이 아니다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const cycleId = await makeClosedCycle(4000);
        await activate(cycleId, { forms: {} });
        const plan = await new retention_service_1.RetentionService(db).plan(cycleId);
        strict_1.default.equal(plan.configured, false);
        strict_1.default.equal(plan.executes, false);
        strict_1.default.ok(plan.items.every((i) => i.status === 'UNSET' || i.status === 'IMMUTABLE'));
    });
    (0, node_test_1.it)('보존기간이 지난 항목만 파기 대상으로 보이고, 지우지는 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        // 마감 400일 경과. 서류 365일은 지났고, 원서 1825일은 남았다.
        const cycleId = await makeClosedCycle(400);
        await activate(cycleId, { retention: retention_fixture_1.VALID_RETENTION });
        const plan = await new retention_service_1.RetentionService(db).plan(cycleId);
        const byCode = Object.fromEntries(plan.items.map((i) => [i.code, i]));
        strict_1.default.equal(plan.configured, true);
        strict_1.default.deepEqual(plan.problems, []);
        strict_1.default.equal(byCode.DOCUMENT_FILE.status, 'DUE');
        strict_1.default.equal(byCode.DOCUMENT_FILE.purge, 'OBJECT');
        strict_1.default.equal(byCode.APPLICATION_UNSUBMITTED.status, 'DUE');
        strict_1.default.equal(byCode.APPLICATION_UNSUBMITTED.purge, 'CONTENT', '행은 지우지 않는다 — 감사 체인이 참조한다');
        strict_1.default.equal(byCode.APPLICATION_SUBMITTED.status, 'RETAINED');
        strict_1.default.equal(byCode.APPLICATION_SUBMITTED.affected, null);
        strict_1.default.equal(byCode.AUDIT_EVENT.status, 'IMMUTABLE');
        strict_1.default.equal(byCode.ACTIVATION_RECORD.status, 'IMMUTABLE');
    });
});
//# sourceMappingURL=retention.integration.test.js.map