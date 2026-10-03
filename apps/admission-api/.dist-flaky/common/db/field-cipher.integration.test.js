"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const dependency_breakers_1 = require("../resilience/dependency-breakers");
const break_glass_1 = require("../../test-support/break-glass");
const audit_service_1 = require("../../modules/audit/audit.service");
const application_repository_1 = require("../../modules/application/application.repository");
const application_state_service_1 = require("../../modules/application/application-state.service");
const profile_vault_client_1 = require("../../modules/application/profile-vault.client");
const field_cipher_1 = require("./field-cipher");
/**
 * 원서 항목 값 암호화 — 실제 DB 로 (T-M5-06, docs/13 단계 3)
 *
 * 끝났다고 말할 근거: DB 에 평문 없음, KEK 교체 뒤 옛 데이터 읽힘, 키 없으면 닫힌 실패.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const SECRET = '주민 몰래 적은 자기소개 문장 0101-SECRET';
let db;
let available = false;
let applicantId;
let applicationId;
const k1 = { id: 'it-k1', key: (0, node_crypto_1.randomBytes)(32) };
const k2 = { id: 'it-k2', key: (0, node_crypto_1.randomBytes)(32) };
const repo = () => new application_repository_1.ApplicationRepository(db, new audit_service_1.AuditService(), new application_state_service_1.ApplicationStateService(), new profile_vault_client_1.ProfileVaultClient(new dependency_breakers_1.DependencyBreakers()));
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    (0, server_kit_1.useFieldKeyRing)(new server_kit_1.LocalKeyRing([k1]));
    (0, field_cipher_1.forgetDataKeysForTest)();
    applicantId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'none')`, [applicantId, `subj-fc-${applicantId.slice(0, 8)}`]);
    const { row } = await repo().create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: DEPT });
    applicationId = row.id;
});
(0, node_test_1.after)(async () => {
    (0, server_kit_1.useFieldKeyRing)(null);
    (0, field_cipher_1.forgetDataKeysForTest)();
    if (!available)
        return;
    await (0, break_glass_1.breakGlass)(async (c) => {
        await c.query(`DELETE FROM audit_event WHERE application_id = $1`, [applicationId]);
        await c.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [applicationId]);
        await c.query(`DELETE FROM application_field_value WHERE application_id = $1`, [applicationId]);
        await c.query(`DELETE FROM consent_record WHERE application_id = $1`, [applicationId]);
        await c.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
        await c.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('원서 항목 값 암호화 — 실제 DB (T-M5-06)', () => {
    (0, node_test_1.it)('저장한 값은 DB 어디에도 평문으로 없고, 앱으로는 그대로 읽힌다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        await repo().patch({ applicationId, expectedVersion: 1n, fields: { selfIntro: SECRET, gpa: 4.2 }, schemaVersion: 'v-test' });
        const raw = await db.query(`SELECT field_code, value_json, value_ciphertext FROM application_field_value WHERE application_id = $1`, [applicationId]);
        strict_1.default.equal(raw.rows.length, 2);
        for (const r of raw.rows) {
            strict_1.default.equal(r.value_json, null, `${r.field_code} 평문 칸은 비어 있다`);
            strict_1.default.ok(r.value_ciphertext && !r.value_ciphertext.includes(Buffer.from('SECRET')), `${r.field_code} 암호문에 평문이 없다`);
        }
        // 테이블 전체를 글자로 떠도 없다(덤프·백업이 새어도)
        const dump = await db.query(`SELECT bool_or(t::text LIKE '%SECRET%') AS hit FROM application_field_value t WHERE application_id = $1`, [applicationId]);
        strict_1.default.equal(dump.rows[0]?.hit, false);
        const key = await db.query(`SELECT kek_version FROM application_data_key WHERE application_id = $1`, [applicationId]);
        strict_1.default.equal(key.rows[0]?.kek_version, 'it-k1');
        (0, field_cipher_1.forgetDataKeysForTest)();
        strict_1.default.deepEqual(await repo().fields(applicationId), { selfIntro: SECRET, gpa: 4.2 });
    });
    (0, node_test_1.it)('암호문을 다른 항목으로 옮겨 붙이면 풀리지 않는다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        // 한 트랜잭션 안에서 바꿔 보고 되돌린다(오류가 나면 db.tx 가 ROLLBACK)
        await strict_1.default.rejects(db.tx(async (c) => {
            await c.query(`UPDATE application_field_value SET value_ciphertext =
             (SELECT value_ciphertext FROM application_field_value WHERE application_id = $1 AND field_code = 'selfIntro')
            WHERE application_id = $1 AND field_code = 'gpa'`, [applicationId]);
            await (0, field_cipher_1.loadFields)(c, applicationId);
        }), server_kit_1.FieldKeyUnavailable);
        strict_1.default.equal((await repo().fields(applicationId)).gpa, 4.2, '되돌린 뒤 그대로');
    });
    (0, node_test_1.it)('KEK 교체 — 옛 원서는 계속 읽히고, rewrap 뒤에는 옛 KEK 를 빼도 읽힌다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        (0, server_kit_1.useFieldKeyRing)(new server_kit_1.LocalKeyRing([k2, k1]));
        (0, field_cipher_1.forgetDataKeysForTest)();
        strict_1.default.equal((await repo().fields(applicationId)).selfIntro, SECRET);
        let moved = 0;
        for (let n = -1; n !== 0; moved += n)
            n = await (0, field_cipher_1.rewrapDataKeys)(db, 'it-k1'); // 이 시험의 KEK 로 감싼 것만 — 같은 DB 의 다른 원서(개발 KEK)는 두고
        strict_1.default.ok(moved >= 1);
        const key = await db.query(`SELECT kek_version FROM application_data_key WHERE application_id = $1`, [applicationId]);
        strict_1.default.equal(key.rows[0]?.kek_version, 'it-k2');
        (0, server_kit_1.useFieldKeyRing)(new server_kit_1.LocalKeyRing([k2]));
        (0, field_cipher_1.forgetDataKeysForTest)();
        strict_1.default.equal((await repo().fields(applicationId)).selfIntro, SECRET);
    });
    (0, node_test_1.it)('닫힌 실패 — KEK 가 없으면 빈 값이 아니라 오류(화면은 재시도 안내 503)', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        (0, server_kit_1.useFieldKeyRing)(new server_kit_1.LocalKeyRing([{ id: 'it-other', key: (0, node_crypto_1.randomBytes)(32) }]));
        (0, field_cipher_1.forgetDataKeysForTest)();
        await strict_1.default.rejects(repo().fields(applicationId), (e) => e instanceof server_kit_1.FieldKeyUnavailable && e.reason === 'unknown-kek');
        (0, server_kit_1.useFieldKeyRing)(new server_kit_1.LocalKeyRing([k2]));
    });
    (0, node_test_1.it)('0003 이전 평문 행 — 읽히고, encrypt-legacy 가 암호문으로 옮긴다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        await db.query(`INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json)
       VALUES ($1, $2, 'legacyNote', 'v-old', $3)`, [(0, node_crypto_1.randomUUID)(), applicationId, JSON.stringify('옛 평문 SECRET')]);
        strict_1.default.equal((await repo().fields(applicationId)).legacyNote, '옛 평문 SECRET');
        let moved = 0;
        for (let n = -1; n !== 0; moved += n)
            n = await (0, field_cipher_1.encryptLegacy)(db);
        strict_1.default.ok(moved >= 1);
        const left = await db.query(`SELECT count(*)::text AS n FROM application_field_value WHERE application_id = $1 AND value_ciphertext IS NULL`, [applicationId]);
        strict_1.default.equal(left.rows[0]?.n, '0');
        (0, field_cipher_1.forgetDataKeysForTest)();
        strict_1.default.equal((await repo().fields(applicationId)).legacyNote, '옛 평문 SECRET');
    });
});
//# sourceMappingURL=field-cipher.integration.test.js.map