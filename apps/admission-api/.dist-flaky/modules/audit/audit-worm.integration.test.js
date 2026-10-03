"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const client_s3_1 = require("@aws-sdk/client-s3");
const server_kit_1 = require("@wonseoro/server-kit");
const break_glass_1 = require("../../test-support/break-glass");
const audit_worm_1 = require("./audit-worm");
/**
 * 감사 기록 WORM — 실제 MinIO Object Lock 으로 (T-M3-03, D-75)
 * DB 슈퍼유저가 감사 기록을 고치거나 지워도 WORM 조각과 맞춰 찾아낸다. 조각은 보관 기간 동안 지울 수 없다.
 * MinIO(:9000)·DB 가 없으면 건너뛴다. 시험마다 새 버킷(Object Lock 버킷은 잠긴 조각이 있으면 지울 수 없다 — 보관 1일)
 */
const ENDPOINT = process.env.WORM_TEST_S3_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = `audit-worm-it-${Date.now()}`;
const UNIV = `WORM-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`;
const client = new client_s3_1.S3Client({ region: 'us-east-1', endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'wonseoro', secretAccessKey: 'wonseoro123' } });
const store = new audit_worm_1.S3WormStore(client, BUCKET);
const ids = [(0, node_crypto_1.randomUUID)(), (0, node_crypto_1.randomUUID)(), (0, node_crypto_1.randomUUID)()];
const applicantId = (0, node_crypto_1.randomUUID)();
const applicationId = (0, node_crypto_1.randomUUID)();
let db;
let available = false;
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    if (!(await db.healthy()))
        return;
    try {
        await store.ensureBucket();
    }
    catch {
        return; // MinIO 없음
    }
    available = true;
    // 이 시험만의 원서에 붙인다 — 원서 없는 기록(운영자 체인)에 가짜 해시를 넣으면 동시에 도는 체인 검사 시험이 깨진다
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'none')`, [applicantId, `subj-worm-${applicantId.slice(0, 8)}`]);
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1, '11111111-1111-1111-1111-111111111111', $2, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'CANCELLED')`, [applicationId, applicantId]);
    for (const [i, id] of ids.entries()) {
        await db.query(`INSERT INTO audit_event (id, application_id, actor_type, actor_id, action, result, event_hash, details_redacted, occurred_at)
       VALUES ($1, $4, 'SYSTEM', 'worm-test', 'WORM_TEST', 'ACCEPTED', $2, '{"n":1}', now() - interval '10 minutes' + make_interval(secs => $3))`, [id, `hash-${i}`, i, applicationId]);
    }
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await (0, break_glass_1.breakGlass)(async (c) => {
        await c.query(`DELETE FROM audit_event WHERE application_id = $1`, [applicationId]);
        await c.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
        await c.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    });
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('감사 기록 WORM (T-M3-03)', () => {
    let firstKey = '';
    (0, node_test_1.it)('감사 기록을 조각으로 내보내고, 이어서 내보내면 겹치지 않는다', async (t) => {
        if (!available)
            return t.skip('DB·MinIO 없음');
        const opts = { university: UNIV, settleSeconds: 60, batch: 100_000, retentionDays: 1 };
        const first = await (0, audit_worm_1.exportAuditSegment)(db, store, opts);
        strict_1.default.ok(first.exported >= 3 && first.key);
        firstKey = first.key;
        const again = await (0, audit_worm_1.exportAuditSegment)(db, store, opts);
        strict_1.default.equal(again.exported, 0, '이미 내보낸 기록은 다시 내보내지 않는다(키 이름이 이어 내보낼 자리)');
        const body = (await store.get(firstKey)).toString('utf8');
        for (const id of ids)
            strict_1.default.ok(body.includes(id));
    });
    (0, node_test_1.it)('조각은 보관 기간 동안 지울 수도 보관을 줄일 수도 없다(COMPLIANCE)', async (t) => {
        if (!available)
            return t.skip('DB·MinIO 없음');
        const head = await client.send(new client_s3_1.HeadObjectCommand({ Bucket: BUCKET, Key: firstKey }));
        strict_1.default.equal(head.ObjectLockMode, 'COMPLIANCE');
        await strict_1.default.rejects(client.send(new client_s3_1.DeleteObjectCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId })));
        await strict_1.default.rejects(client.send(new client_s3_1.PutObjectRetentionCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId, Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(Date.now() + 60_000) } })));
    });
    (0, node_test_1.it)('DB 에서 고치거나 지운 감사 기록을 WORM 과 맞춰 찾아낸다(슈퍼유저가 트리거를 꺼도)', async (t) => {
        if (!available)
            return t.skip('DB·MinIO 없음');
        const clean = await (0, audit_worm_1.verifyAuditWorm)(db, store, UNIV);
        strict_1.default.equal(clean.alteredInDb.filter((x) => ids.includes(x)).length, 0);
        await (0, break_glass_1.breakGlass)(async (c) => {
            await c.query(`UPDATE audit_event SET result = 'REJECTED' WHERE id = $1`, [ids[0]]);
            await c.query(`DELETE FROM audit_event WHERE id = $1`, [ids[1]]);
        });
        const r = await (0, audit_worm_1.verifyAuditWorm)(db, store, UNIV);
        strict_1.default.ok(r.alteredInDb.includes(ids[0]), '고친 기록');
        strict_1.default.ok(r.missingInDb.includes(ids[1]), '지운 기록');
        strict_1.default.ok(!r.alteredInDb.includes(ids[2]) && !r.missingInDb.includes(ids[2]), '손대지 않은 기록은 그대로');
    });
});
//# sourceMappingURL=audit-worm.integration.test.js.map