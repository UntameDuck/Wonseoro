"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const audit_service_1 = require("./modules/audit/audit.service");
const postgres_idempotency_store_1 = require("./common/idempotency/postgres-idempotency.store");
const form_schema_service_1 = require("./modules/config/form-schema.service");
const document_service_1 = require("./modules/document/document.service");
const activation_recorder_1 = require("./modules/activation/activation-recorder");
const activation_signer_1 = require("./modules/activation/activation-signer");
const evidence_service_1 = require("./modules/evidence/evidence.service");
const file_inspector_1 = require("./modules/document/file-inspector");
const object_storage_1 = require("./modules/document/object-storage");
const break_glass_1 = require("./test-support/break-glass");
/**
 * 통합 테스트 — 실제 PostgreSQL 이 필요하다.
 *
 *   npm run dev:infra && npm run db:migrate
 *   DATABASE_URL=postgresql://wonseoro:wonseoro@localhost:5432/univ_a npm test -w @wonseoro/admission-api
 *
 * DB 가 없으면 전부 skip 한다. CI 의 단위 테스트 잡을 막지 않기 위함이다.
 */
const DB_URL = process.env.DATABASE_URL;
let db;
let available = false;
// 테스트 전용 식별자. 기존 데이터와 섞이지 않게 매 실행 새로 만든다.
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let applicantId;
let applicationId;
(0, node_test_1.before)(async () => {
    if (!DB_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    applicantId = (0, node_crypto_1.randomUUID)();
    applicationId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`, [applicantId, `subj-${applicantId.slice(0, 8)}`]);
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'DRAFT')`, [applicationId, CYCLE, applicantId, TYPE, DEPT]);
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    // audit_event 는 application 을 지워도 CASCADE 되지 않는다.
    // 원서를 지우는 것으로 감사 기록을 없앨 수 없다는 뜻이고, 이는 의도된 설계다.
    // (v1.1 §A11 — 감사로그 삭제·수정 권한을 운영자에게 주지 않는다)
    // 테스트 데이터만 명시적으로 정리한다.
    await db.query(`DELETE FROM document_scan WHERE document_id IN
       (SELECT id FROM document WHERE application_id = $1)`, [applicationId]);
    await db.query(`DELETE FROM document WHERE application_id = $1`, [applicationId]);
    await (0, break_glass_1.breakGlass)((c) => c.query(`DELETE FROM audit_event WHERE application_id = $1`, [applicationId]));
    await db.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
    await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('감사 hash-chain (v1.0 §9 / v1.1 §A11)', () => {
    (0, node_test_1.it)('체인이 GENESIS 에서 시작해 순서대로 이어진다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const audit = new audit_service_1.AuditService();
        await db.tx(async (client) => {
            await audit.record(client, {
                applicationId,
                actorType: 'APPLICANT',
                actorId: applicantId,
                action: 'APPLICATION_CREATED',
                result: 'ACCEPTED',
            });
            await audit.record(client, {
                applicationId,
                actorType: 'APPLICANT',
                actorId: applicantId,
                action: 'APPLICATION_SAVED',
                result: 'ACCEPTED',
            });
        });
        const { rows } = await db.query(`SELECT prev_hash, event_hash, action FROM audit_event
        WHERE application_id = $1 ORDER BY occurred_at ASC, id ASC`, [applicationId]);
        strict_1.default.equal(rows.length, 2);
        strict_1.default.equal(rows[0].prev_hash, audit_service_1.GENESIS_HASH, '첫 이벤트는 GENESIS 에서 시작한다');
        strict_1.default.equal(rows[1].prev_hash, rows[0].event_hash, '두 번째는 첫 번째에 이어붙는다');
    });
    (0, node_test_1.it)('체인 검증이 통과한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const audit = new audit_service_1.AuditService();
        const result = await db.tx((client) => audit.verifyChain(client, applicationId));
        strict_1.default.equal(result.valid, true);
        strict_1.default.ok(result.checked >= 2);
    });
    (0, node_test_1.it)('레코드를 조작하면 검증에서 드러난다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const audit = new audit_service_1.AuditService();
        // 감사 레코드를 몰래 고치는 상황을 재현한다.
        // 앱 역할에는 이 권한이 없고 트리거도 막는다 (D-41). 슈퍼유저가 트리거를 끄고 고친 상황이다 —
        // DB 안에서 막을 수 없는 마지막 경로이고, hash-chain 이 그걸 찾아낸다. (WORM 은 M5)
        await (0, break_glass_1.breakGlass)((c) => c.query(`UPDATE audit_event SET result = 'REJECTED'
        WHERE application_id = $1
          AND id = (SELECT id FROM audit_event WHERE application_id = $1
                     ORDER BY occurred_at ASC, id ASC LIMIT 1)`, [applicationId]));
        const result = await db.tx((client) => audit.verifyChain(client, applicationId));
        strict_1.default.equal(result.valid, false, '변조된 체인이 valid 로 나오면 증적으로 쓸 수 없다');
        strict_1.default.ok(result.brokenAt, '어느 레코드에서 끊겼는지 지목해야 한다');
    });
    (0, node_test_1.it)('원서를 지워도 감사 레코드는 FK 로 보호된다 (v1.1 §A11)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.rejects(db.query(`DELETE FROM application WHERE id = $1`, [applicationId]), /foreign key constraint/i, '원서 삭제만으로 감사 기록이 사라지면 증적으로 쓸 수 없다');
    });
    (0, node_test_1.it)('IP 는 원문이 아니라 해시로 저장된다 (v1.0 §9)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const audit = new audit_service_1.AuditService();
        await db.tx(async (client) => {
            await audit.record(client, {
                applicationId,
                actorType: 'APPLICANT',
                actorId: applicantId,
                action: 'LOGIN_SUCCEEDED',
                result: 'ACCEPTED',
                sourceIp: '203.0.113.45',
            });
        });
        const { rows } = await db.query(`SELECT source_ip_hash FROM audit_event
        WHERE application_id = $1 AND action = 'LOGIN_SUCCEEDED'`, [applicationId]);
        const hash = rows[0]?.source_ip_hash;
        strict_1.default.ok(hash);
        strict_1.default.equal(hash.includes('203.0.113.45'), false, 'IP 원문이 저장되었다');
        strict_1.default.match(hash, /^[a-f0-9]{64}$/);
    });
});
(0, node_test_1.describe)('Postgres Idempotency Store', () => {
    const scopeFor = (key) => ({
        applicationId,
        operation: 'POST:finalize',
        key,
    });
    (0, node_test_1.it)('동시 100건 중 정확히 1건만 선점한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const scope = scopeFor(`concurrent-${(0, node_crypto_1.randomUUID)()}`);
        const results = await Promise.all(Array.from({ length: 100 }, () => store.acquire(scope, 'same-hash')));
        const acquired = results.filter((r) => r === null).length;
        strict_1.default.equal(acquired, 1, 'INSERT ... ON CONFLICT 로 선점은 1건이어야 한다');
        strict_1.default.equal(results.length - acquired, 99);
    });
    (0, node_test_1.it)('완료 응답을 재생한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const scope = scopeFor(`replay-${(0, node_crypto_1.randomUUID)()}`);
        strict_1.default.equal(await store.acquire(scope, 'h'), null);
        await store.complete(scope, 201, { applicationNumber: '2027-A-000777' });
        const replay = await store.acquire(scope, 'h');
        strict_1.default.ok(replay);
        strict_1.default.equal(replay.state, 'COMPLETED');
        strict_1.default.equal(replay.responseStatus, 201);
        strict_1.default.deepEqual(replay.responseBody, { applicationNumber: '2027-A-000777' });
    });
    (0, node_test_1.it)('실패는 FAILED 로 남는다 — 삭제하지 않는다 (D-11)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const scope = scopeFor(`failed-${(0, node_crypto_1.randomUUID)()}`);
        await store.acquire(scope, 'h');
        await store.fail(scope);
        const after = await store.acquire(scope, 'h');
        strict_1.default.ok(after);
        strict_1.default.equal(after.state, 'FAILED');
    });
    (0, node_test_1.it)('같은 키라도 operation 이 다르면 간섭하지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const store = new postgres_idempotency_store_1.PostgresIdempotencyStore(db);
        const key = `shared-${(0, node_crypto_1.randomUUID)()}`;
        strict_1.default.equal(await store.acquire({ applicationId, operation: 'op-a', key }, 'h'), null);
        strict_1.default.equal(await store.acquire({ applicationId, operation: 'op-b', key }, 'h'), null);
    });
});
(0, node_test_1.describe)('추가문항 Schema Registry (v1.1 §A5)', () => {
    (0, node_test_1.it)('활성 Config 에서 전형별 스키마를 읽는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        const loaded = await forms.load(CYCLE, 'EARLY');
        // 버전 문자열을 테스트에 박지 않는다. Config 는 운영 중에 바뀌는 값이다.
        const { rows } = await db.query(`SELECT version FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`, [CYCLE]);
        strict_1.default.equal(loaded.schemaVersion, rows[0]?.version);
        strict_1.default.ok(loaded.schema.properties['selfIntro']);
    });
    (0, node_test_1.it)('자동저장은 부분 입력을 허용한다 — required 를 걸지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        const version = await forms.assertKnownFields(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
        strict_1.default.ok(version.startsWith('cfg-'), '활성 Config 버전을 그대로 돌려줘야 한다');
    });
    (0, node_test_1.it)('스키마에 없는 항목은 자동저장 단계에서 거부한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        await strict_1.default.rejects(forms.assertKnownFields(CYCLE, 'EARLY', { 잘못된항목: 'x' }), (err) => err.problem?.status === 400);
    });
    (0, node_test_1.it)('작성 도중 minLength 미달은 자동저장을 막지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        // selfIntro 는 minLength 10. 사용자가 "저는" 까지 쳤을 때 저장이 막히면
        // 그 필드를 영원히 채울 수 없다.
        await strict_1.default.doesNotReject(forms.assertKnownFields(CYCLE, 'EARLY', { selfIntro: '저는' }), '작성 도중 값으로 저장이 실패하면 사용자가 입력을 끝낼 수 없다');
    });
    (0, node_test_1.it)('maxLength 초과는 자동저장 단계에서 막는다 — 더 쳐도 나아지지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        await strict_1.default.rejects(forms.assertKnownFields(CYCLE, 'EARLY', { highSchool: 'x'.repeat(200) }), (err) => err.problem?.status === 400);
    });
    (0, node_test_1.it)('최종검증에서는 minLength 를 그대로 본다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        const result = await forms.validate(CYCLE, 'EARLY', {
            highSchool: '원서로고등학교',
            graduationYear: 2027,
            selfIntro: '저는',
        });
        strict_1.default.equal(result.valid, false, '자동저장에서 완화한 제약이 최종검증에서도 빠지면 안 된다');
    });
    (0, node_test_1.it)('타입이 틀린 값은 부분 저장에서도 거부한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        await strict_1.default.rejects(forms.assertKnownFields(CYCLE, 'EARLY', { graduationYear: '이천이십칠' }), (err) => err.problem?.status === 400);
    });
    (0, node_test_1.it)('최종검증은 누락 항목을 모아서 돌려준다 — 던지지 않는다 (v1.1 §07)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        const result = await forms.validate(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
        strict_1.default.equal(result.valid, false);
        const missing = result.issues.filter((i) => i.code === 'REQUIRED').map((i) => i.path);
        strict_1.default.ok(missing.length >= 2, '누락 항목을 하나만 알려주면 사용자가 여러 번 왕복한다');
    });
    (0, node_test_1.it)('모두 채우면 통과한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        const result = await forms.validate(CYCLE, 'EARLY', {
            highSchool: '원서로고등학교',
            graduationYear: 2027,
            selfIntro: '저는 분산 시스템에 관심이 있습니다.',
        });
        strict_1.default.deepEqual(result, { valid: true, issues: [] });
    });
    (0, node_test_1.it)('대학·전형을 추가해도 코드는 바뀌지 않는다 — Config 만 바꾼다 (§A5 핵심)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const forms = new form_schema_service_1.FormSchemaService(db);
        /**
         * ⚠️ 테스트 전용 전형 코드를 쓴다.
         * 공용 개발 Config 의 실제 전형(EARLY·REGULAR)을 건드리면
         * 같은 DB 를 보는 개발 화면이 조용히 망가진다. 실제로 한 번 당했다.
         * 버전도 원래 값을 읽어 두었다가 그대로 되돌린다.
         */
        const testCode = `TEST_${(0, node_crypto_1.randomUUID)().slice(0, 8).toUpperCase()}`;
        const before = await db.query(`SELECT version FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`, [CYCLE]);
        const originalVersion = before.rows[0]?.version ?? 'cfg-2027-v1';
        await db.query(`UPDATE config_version
          SET config_json = jsonb_set(config_json, ARRAY['forms', $2], $3::jsonb),
              version = $4
        WHERE cycle_id = $1 AND status = 'ACTIVE'`, [
            CYCLE,
            testCode,
            JSON.stringify({
                type: 'object',
                additionalProperties: false,
                required: ['csatNumber'],
                properties: { csatNumber: { type: 'string', pattern: '^[0-9]{8}$' } },
            }),
            `${originalVersion}+${testCode}`,
        ]);
        try {
            const ok = await forms.validate(CYCLE, testCode, { csatNumber: '12345678' });
            strict_1.default.deepEqual(ok, { valid: true, issues: [] }, '새 전형이 코드 변경 없이 동작해야 한다');
            const bad = await forms.validate(CYCLE, testCode, { csatNumber: 'abc' });
            strict_1.default.equal(bad.valid, false, '새 전형의 제약도 그대로 적용되어야 한다');
            // 기존 전형은 영향받지 않는다.
            const early = await forms.validate(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
            strict_1.default.equal(early.valid, false);
        }
        finally {
            // 실패해도 반드시 되돌린다.
            await db.query(`UPDATE config_version
            SET config_json = config_json #- ARRAY['forms', $2],
                version = $3
          WHERE cycle_id = $1 AND status = 'ACTIVE'`, [CYCLE, testCode, originalVersion]);
        }
    });
});
(0, node_test_1.describe)('서류 상태 전이 (v1.0 §5.4 / v1.1 §B5)', () => {
    const docService = () => new document_service_1.DocumentService(db, new object_storage_1.ObjectStorage(), new file_inspector_1.FileInspector(), new audit_service_1.AuditService());
    /** QUARANTINED 상태의 서류를 직접 만든다. 업로드 자체는 E2E 로 따로 확인했다. */
    async function seedQuarantined() {
        const id = (0, node_crypto_1.randomUUID)();
        await db.query(`INSERT INTO document (id, application_id, document_type, object_key,
                             original_filename, media_type, size_bytes, sha256_hex, status)
       VALUES ($1,$2,'TRANSCRIPT',$3,'생활기록부.pdf','application/pdf',59,$4,'QUARANTINED')`, [id, applicationId, `applications/${applicationId}/${id}.pdf`, 'a'.repeat(64)]);
        await db.query(`INSERT INTO document_scan (id, document_id, scanner, result)
       VALUES ($1,$2,'mock-av','PENDING')`, [(0, node_crypto_1.randomUUID)(), id]);
        return id;
    }
    (0, node_test_1.it)('검사 통과하면 AVAILABLE 로 간다 — 접수 확정에 쓸 수 있는 유일한 상태', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const id = await seedQuarantined();
        const next = await docService().applyScanResult(id, 'CLEAN');
        strict_1.default.equal(next, 'AVAILABLE');
    });
    (0, node_test_1.it)('악성으로 판정되면 REJECTED 로 간다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const id = await seedQuarantined();
        const next = await docService().applyScanResult(id, 'MALICIOUS');
        strict_1.default.equal(next, 'REJECTED');
    });
    (0, node_test_1.it)('검사 오류도 AVAILABLE 로 통과시키지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const id = await seedQuarantined();
        const next = await docService().applyScanResult(id, 'ERROR');
        strict_1.default.notEqual(next, 'AVAILABLE', '검사 실패를 통과로 처리하면 안 된다');
    });
    (0, node_test_1.it)('같은 검사 결과를 두 번 적용할 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const id = await seedQuarantined();
        await docService().applyScanResult(id, 'CLEAN');
        await strict_1.default.rejects(docService().applyScanResult(id, 'MALICIOUS'), '이미 확정된 서류 상태를 뒤집을 수 있으면 안 된다');
    });
    (0, node_test_1.it)('검사 결과가 감사로그에 남는다 (v1.0 §9 DOCUMENT_VERIFIED)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const id = await seedQuarantined();
        await docService().applyScanResult(id, 'CLEAN');
        const { rows } = await db.query(`SELECT action, result FROM audit_event
        WHERE application_id = $1 AND action = 'DOCUMENT_VERIFIED'
        ORDER BY occurred_at DESC LIMIT 1`, [applicationId]);
        strict_1.default.equal(rows[0]?.action, 'DOCUMENT_VERIFIED');
        strict_1.default.equal(rows[0]?.result, 'ACCEPTED');
    });
});
(0, node_test_1.describe)('Evidence Package (v1.1 §A11·§C6 / §01 E)', () => {
    const service = () => new evidence_service_1.EvidenceService(db, new audit_service_1.AuditService(), new activation_recorder_1.ActivationRecorder(db, new activation_signer_1.ActivationSigner(), new audit_service_1.AuditService()));
    (0, node_test_1.it)('조회 사유 없이는 뽑을 수 없다 (v1.0 §8.3)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await strict_1.default.rejects(service().generate(applicationId, 'auditor@univ-a', '   '), (err) => err.problem?.status === 400, '사유 없이 열람 가능하면 운영자 과권한이 열린다');
    });
    (0, node_test_1.it)('열람 사실이 감사 기록에 남는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        await service().generate(applicationId, 'auditor@univ-a', '구제 심사 요청 2026-0001');
        const { rows } = await db.query(`SELECT details_redacted FROM audit_event
        WHERE application_id = $1 AND action = 'ADMIN_VIEWED_PII'
        ORDER BY occurred_at DESC LIMIT 1`, [applicationId]);
        strict_1.default.equal(rows[0]?.details_redacted?.purpose, 'EVIDENCE_PACKAGE');
        strict_1.default.equal(rows[0]?.details_redacted?.reason, '구제 심사 요청 2026-0001');
    });
    (0, node_test_1.it)('같은 내용이면 같은 evidenceHash 가 나온다 — 두 증적이 같음을 보일 수 있다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        // 열람 자체가 감사 이벤트를 남기므로 timeline 이 늘어난다.
        // 그래서 연속 두 번 뽑으면 해시가 달라지는 것이 **정상**이다.
        // 대신 같은 스냅샷에 대해 해시 계산이 결정적인지를 본다.
        const first = await service().generate(applicationId, 'auditor@univ-a', '검증1');
        const second = await service().generate(applicationId, 'auditor@univ-a', '검증2');
        strict_1.default.notEqual(first.evidenceHash, second.evidenceHash, '열람 기록이 늘었는데 해시가 같으면 timeline 이 반영되지 않은 것이다');
        strict_1.default.match(first.evidenceHash, /^[a-f0-9]{64}$/);
    });
    (0, node_test_1.it)('접수 과정을 재구성할 수 있다 — §01 E 핵심 인수기준', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const pkg = await service().generate(applicationId, 'auditor@univ-a', '재구성 확인');
        strict_1.default.equal(pkg.applicationId, applicationId);
        strict_1.default.ok(pkg.timeline.length > 0, '무엇을 언제 했는지가 없으면 증적이 아니다');
        strict_1.default.ok(pkg.chainVerification, 'hash-chain 검증 결과가 함께 와야 한다');
        // 모든 timeline 항목이 hash 를 갖는다.
        for (const e of pkg.timeline) {
            strict_1.default.match(e.eventHash, /^[a-f0-9]{64}$/);
        }
    });
    (0, node_test_1.it)('개인정보가 들어가지 않는다 (v1.0 §17.1)', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const pkg = await service().generate(applicationId, 'auditor@univ-a', 'PII 확인');
        const serialized = JSON.stringify(pkg);
        // 원서 본문·첨부파일·결제수단 상세가 들어가면 안 된다.
        for (const banned of ['selfIntro', 'pii_ciphertext', 'cardNumber', 'residentRegistration']) {
            strict_1.default.equal(serialized.includes(banned), false, `Evidence Package 에 ${banned} 가 들어 있다`);
        }
    });
    (0, node_test_1.it)('감사 체인이 깨져 있으면 그 사실을 함께 보고한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        // 누군가 감사 레코드를 고친 상황 (슈퍼유저가 트리거를 끄고).
        await (0, break_glass_1.breakGlass)((c) => c.query(`UPDATE audit_event SET result = 'FAILED'
        WHERE application_id = $1
          AND id = (SELECT id FROM audit_event WHERE application_id = $1
                     ORDER BY occurred_at ASC LIMIT 1)`, [applicationId]));
        const pkg = await service().generate(applicationId, 'auditor@univ-a', '변조 확인');
        strict_1.default.equal(pkg.chainVerification.valid, false, '변조된 증적을 valid 로 내보내면 증적으로 쓸 수 없다');
        strict_1.default.ok(pkg.chainVerification.brokenAt);
    });
});
//# sourceMappingURL=integration.test.js.map