"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const break_glass_1 = require("../../test-support/break-glass");
const audit_service_1 = require("../audit/audit.service");
const application_repository_1 = require("../application/application.repository");
const application_state_service_1 = require("../application/application-state.service");
const profile_vault_client_1 = require("../application/profile-vault.client");
const config_compat_1 = require("./config-compat");
/**
 * 진행 중 원서와의 호환 시험 — 실제 DB 로 (T-M6-02, D-77)
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db;
let available = false;
let typeCode = '';
const applicants = [(0, node_crypto_1.randomUUID)(), (0, node_crypto_1.randomUUID)()];
const apps = [];
const repo = () => new application_repository_1.ApplicationRepository(db, new audit_service_1.AuditService(), new application_state_service_1.ApplicationStateService(), new profile_vault_client_1.ProfileVaultClient(new dependency_breakers_1.DependencyBreakers()));
const form = (props, required = []) => ({ forms: { [typeCode]: { type: 'object', properties: props, required } } });
const mine = (r) => r.broken.filter((b) => apps.includes(b.applicationId));
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    typeCode = (await db.query(`SELECT code FROM admission_type WHERE id = $1`, [TYPE])).rows[0]?.code ?? '';
    for (const id of applicants) {
        await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'none')`, [id, `subj-compat-${id.slice(0, 8)}`]);
        const { row } = await repo().create({ cycleId: CYCLE, applicantId: id, admissionTypeId: TYPE, departmentId: DEPT });
        await repo().patch({ applicationId: row.id, expectedVersion: BigInt(row.version), fields: { selfIntro: '열 글자를 넘는 자기소개 문장입니다', gpa: 4.1 }, schemaVersion: 'v-compat' });
        apps.push(row.id);
    }
    // 둘째 원서는 검증을 마쳤다(READY) — 새 필수 항목이 생기면 막힌다
    await (0, break_glass_1.breakGlass)((c) => c.query(`UPDATE kadmission.application SET status = 'READY' WHERE id = $1`, [apps[1]]));
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await (0, break_glass_1.breakGlass)(async (c) => {
        await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = ANY($1::uuid[])`, [apps]);
        await c.query(`DELETE FROM kadmission.outbox_event WHERE aggregate_id = ANY($1::uuid[])`, [apps]);
        await c.query(`DELETE FROM kadmission.consent_record WHERE application_id = ANY($1::uuid[])`, [apps]);
        await c.query(`DELETE FROM kadmission.application WHERE id = ANY($1::uuid[])`, [apps]);
        await c.query(`DELETE FROM kadmission.applicant WHERE id = ANY($1::uuid[])`, [applicants]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('진행 중 원서와의 호환 시험 (T-M6-02)', () => {
    (0, node_test_1.it)('저장된 값과 맞는 설정은 통과한다 — 작성 중 원서의 빈 필수 항목은 지원자가 채운다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const r = await (0, config_compat_1.checkInFlightCompatibility)(db, CYCLE, form({ selfIntro: { type: 'string', maxLength: 500 }, gpa: { type: 'number' }, essay: { type: 'string' } }));
        strict_1.default.deepEqual(mine(r).map((b) => b.applicationId), [], '두 원서 모두 맞다');
        strict_1.default.ok(r.checked >= 2);
    });
    (0, node_test_1.it)('최대 글자 수를 줄이면 저장된 값이 어긋난 원서를 모두 찾는다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const r = await (0, config_compat_1.checkInFlightCompatibility)(db, CYCLE, form({ selfIntro: { type: 'string', maxLength: 10 }, gpa: { type: 'number' } }));
        strict_1.default.equal(mine(r).length, 2);
        strict_1.default.ok(mine(r).every((b) => b.problems.some((p) => p.includes('/selfIntro maxLength'))));
    });
    (0, node_test_1.it)('형식을 바꾸면(숫자 → 글자) 어긋난다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const r = await (0, config_compat_1.checkInFlightCompatibility)(db, CYCLE, form({ selfIntro: { type: 'string' }, gpa: { type: 'string' } }));
        strict_1.default.equal(mine(r).length, 2);
    });
    (0, node_test_1.it)('필수 항목을 더하면 검증을 마친 원서만 막힌다(작성 중 원서는 채울 수 있다)', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const r = await (0, config_compat_1.checkInFlightCompatibility)(db, CYCLE, form({ selfIntro: { type: 'string' }, gpa: { type: 'number' }, essay: { type: 'string' } }, ['essay']));
        strict_1.default.deepEqual(mine(r).map((b) => `${b.status}:${b.problems.join(',')}`), ['READY:/ required(essay)']);
    });
});
//# sourceMappingURL=config-compat.integration.test.js.map