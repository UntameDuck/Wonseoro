"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const leader_lock_1 = require("./leader-lock");
/**
 * 리더 잠금 회귀 시험 (D-54). 세션 잠금은 PgBouncer transaction 풀에서 서버 연결에 새어 남았다.
 * 여기서는 PgBouncer 없이도 확인할 수 있는 성질을 본다 — 작업이 끝나면(성공·실패 모두) 잠금이 하나도 남지 않고,
 * 쥐고 있는 동안에는 다른 호출이 들어오지 못한다.
 */
let db;
let available = false;
const heldLeaderLocks = async () => {
    const { rows } = await db.query(`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1`, [leader_lock_1.LEADER_LOCK_CLASS]);
    return Number(rows[0]?.n ?? 0);
};
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
});
(0, node_test_1.after)(async () => {
    if (available)
        await db.onApplicationShutdown();
});
(0, node_test_1.describe)('withLeaderLock (D-54)', () => {
    (0, node_test_1.it)('작업이 끝나면 잠금이 남지 않는다 — 성공·실패 모두', { skip: !process.env.DATABASE_URL }, async () => {
        if (!available)
            return;
        const name = `test:leader:${Date.now()}`;
        strict_1.default.equal(await (0, leader_lock_1.withLeaderLock)(db, name, async () => heldLeaderLocks()), 1, '작업 중에는 잠금이 하나 있다');
        strict_1.default.equal(await heldLeaderLocks(), 0);
        await strict_1.default.rejects((0, leader_lock_1.withLeaderLock)(db, name, async () => { throw new Error('작업 실패'); }), /작업 실패/);
        strict_1.default.equal(await heldLeaderLocks(), 0, '작업이 실패해도 잠금이 풀린다');
        strict_1.default.equal(await (0, leader_lock_1.withLeaderLock)(db, name, async () => 'again'), 'again', '다음 주기가 다시 잡는다');
    });
    (0, node_test_1.it)('쥐고 있는 동안 다른 호출은 작업을 부르지 않는다', { skip: !process.env.DATABASE_URL }, async () => {
        if (!available)
            return;
        const name = `test:leader:${Date.now()}:busy`;
        let inner = 'not-called';
        const outer = await (0, leader_lock_1.withLeaderLock)(db, name, async () => {
            inner = await (0, leader_lock_1.withLeaderLock)(db, name, async () => 'ran');
            return 'outer';
        });
        strict_1.default.equal(outer, 'outer');
        strict_1.default.equal(inner, null, '두 번째 호출은 잠금을 못 잡고 null');
    });
});
//# sourceMappingURL=leader-lock.integration.test.js.map