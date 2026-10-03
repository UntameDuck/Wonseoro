"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const pg_1 = require("pg");
const server_kit_1 = require("@wonseoro/server-kit");
const break_glass_1 = require("../../test-support/break-glass");
/**
 * Writer fencing·승격 잠금 — 실제 DB 로 (T-M5-63, §01 A10, 0006)
 * 장애 전환 뒤 옛 Primary 가 돌아와도, 새 세대를 아는 앱의 쓰기는 옛 세대 DB 가 거절한다. 세대는 승격 함수로 하나씩만 오른다.
 */
let available = false;
const made = [];
const agg = (0, node_crypto_1.randomUUID)();
/** 앱 하나 — WRITER_EPOCH 는 Db 를 만들 때 읽는다 */
function app(epoch) {
    if (epoch)
        process.env.WRITER_EPOCH = epoch;
    else
        delete process.env.WRITER_EPOCH;
    const db = new server_kit_1.Db('admission-api', 'kadmission');
    delete process.env.WRITER_EPOCH;
    made.push(db);
    return db;
}
const write = (db, seq) => db.query(`INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash)
     VALUES ($1, $2, $3, 'kr.wonseoro.admission.application.finalized', '1', '{}', 'h')`, [(0, node_crypto_1.randomUUID)(), agg, seq]);
const admin = (sql, params = []) => (0, break_glass_1.breakGlass)(async (c) => (await c.query(sql, params)).rows);
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    const probe = app(null);
    available = await probe.healthy();
    if (available)
        await admin(`UPDATE kadmission.writer_fence SET epoch = 1, require_token = false`);
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await admin(`DELETE FROM kadmission.outbox_event WHERE aggregate_id = $1`, [agg]);
    await admin(`UPDATE kadmission.writer_fence SET epoch = 1, require_token = false, promoted_by = 'initial'`);
    for (const db of made)
        await db.onApplicationShutdown();
});
(0, node_test_1.describe)('Writer fencing (T-M5-63)', () => {
    (0, node_test_1.it)('세대가 맞으면 쓴다 — 트랜잭션 밖 쓰기도 세대를 넘긴다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const v1 = app('1');
        await write(v1, 1);
        await v1.tx((c) => c.query(`UPDATE outbox_event SET attempt_count = 1 WHERE aggregate_id = $1`, [agg]));
    });
    (0, node_test_1.it)('승격하면 옛 세대를 아는 앱의 쓰기는 거절되고, 새 세대는 쓴다 · 읽기는 그대로', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const promoted = await admin(`SELECT kadmission.promote_writer(2, 'dr-drill')`);
        const promote_writer = promoted[0]?.promote_writer;
        strict_1.default.equal(String(promote_writer), '2');
        const stale = app('1');
        await strict_1.default.rejects(write(stale, 2), /writer fenced/);
        await strict_1.default.rejects(stale.tx((c) => c.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [agg])), /writer fenced/);
        strict_1.default.equal((await stale.query(`SELECT count(*)::int AS n FROM outbox_event WHERE aggregate_id = $1`, [agg])).rows[0]?.n, 1, '읽기는 막지 않는다');
        await write(app('2'), 2);
    });
    (0, node_test_1.it)('옛 Primary 가 돌아와도(옛 세대 DB) 새 세대를 아는 앱은 거기 쓰지 않는다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        // 같은 DB 를 옛 세대로 되돌려 "돌아온 옛 Primary" 를 흉내 낸다
        await admin(`UPDATE kadmission.writer_fence SET epoch = 1`);
        await strict_1.default.rejects(write(app('2'), 3), /writer fenced: 앱의 쓰기 세대 2 ≠ 이 DB 의 세대 1/);
        await admin(`UPDATE kadmission.writer_fence SET epoch = 2`);
    });
    (0, node_test_1.it)('승격 잠금 — 세대는 하나씩만 오르고, 앱 역할은 승격하거나 세대를 바꿀 수 없다', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        await strict_1.default.rejects(admin(`SELECT kadmission.promote_writer(4, 'skip')`), /하나씩만/);
        await strict_1.default.rejects(admin(`SELECT kadmission.promote_writer(2, 'again')`), /하나씩만/);
        const plain = app(null);
        await strict_1.default.rejects(plain.query(`SELECT promote_writer(3, 'app')`), /permission denied/);
        await strict_1.default.rejects(plain.query(`UPDATE writer_fence SET epoch = 99`), /permission denied/);
    });
    (0, node_test_1.it)('require_token 을 켜면 세대 없이 쓰는 길이 막힌다(운영) — 커밋하지 않는 트랜잭션 안에서만(다른 시험이 보지 않게)', async (t) => {
        if (!available)
            return t.skip('DB 없음');
        const c = new pg_1.Client({ connectionString: process.env.DATABASE_ADMIN_URL, options: '-c search_path=kadmission,public' });
        await c.connect();
        try {
            await c.query('BEGIN');
            await c.query(`UPDATE writer_fence SET require_token = true`);
            await c.query('SET LOCAL ROLE kadmission_app');
            await c.query('SAVEPOINT s');
            await strict_1.default.rejects(c.query(`INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash)
                                    VALUES ($1, $2, 9, 'x', '1', '{}', 'h')`, [(0, node_crypto_1.randomUUID)(), agg]), /세대 없이/);
            await c.query('ROLLBACK TO SAVEPOINT s');
            await c.query(`SELECT set_config('kadmission.writer_epoch', '2', true)`);
            await c.query(`INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash)
                     VALUES ($1, $2, 9, 'x', '1', '{}', 'h')`, [(0, node_crypto_1.randomUUID)(), agg]);
        }
        finally {
            await c.query('ROLLBACK').catch(() => undefined);
            await c.end();
        }
    });
});
//# sourceMappingURL=writer-fence.integration.test.js.map