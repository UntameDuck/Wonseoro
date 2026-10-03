"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const problem_filter_1 = require("./problem.filter");
(0, node_test_1.describe)('DB 연결 풀 포화는 재시도 안내(503)로 (T-M4-40 kind 시험에서 발견)', () => {
    (0, node_test_1.it)('pg-pool 연결 대기 초과·PgBouncer·PostgreSQL 연결 상한을 알아본다', () => {
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('timeout exceeded when trying to connect')), true);
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('no more connections allowed (max_client_conn)')), true);
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('sorry, too many clients already')), true);
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('Query read timeout')), true, '노드 장애로 매달린 연결 (T-M4-39)');
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('Connection terminated unexpectedly')), true);
    });
    (0, node_test_1.it)('다른 오류는 그대로 500 이다 — 제약 위반·문법 오류를 재시도로 덮지 않는다', () => {
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(new Error('duplicate key value violates unique constraint')), false);
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)('timeout exceeded when trying to connect'), false);
        strict_1.default.equal((0, problem_filter_1.isTransientDbSaturation)(undefined), false);
    });
});
//# sourceMappingURL=problem.filter.test.js.map