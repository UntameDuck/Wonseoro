"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const problem_exception_1 = require("../problem/problem.exception");
const strict_json_1 = require("./strict-json");
function parse(body) {
    let out = { err: null };
    (0, strict_json_1.strictJsonParser)(null, body, (err, value) => {
        out = { err, value };
    });
    return out;
}
(0, node_test_1.describe)('JSON 본문 파서 (D-37)', () => {
    (0, node_test_1.it)('UTF-8 한글은 그대로 받는다', () => {
        const r = parse(Buffer.from(JSON.stringify({ decisionRef: '입학처-2026-117' }), 'utf8'));
        strict_1.default.equal(r.err, null);
        strict_1.default.deepEqual(r.value, { decisionRef: '입학처-2026-117' });
    });
    (0, node_test_1.it)('CP949 로 보낸 한글은 � 로 바꿔 받지 않고 400 으로 거절한다', () => {
        // "입학" 의 CP949 바이트. 기본 파서는 이것을 �� 로 저장하고 성공이라 답했다.
        const body = Buffer.concat([
            Buffer.from('{"decisionRef":"'),
            Buffer.from([0xc0, 0xd4, 0xc7, 0xd0]),
            Buffer.from('"}'),
        ]);
        const r = parse(body);
        strict_1.default.ok(r.err instanceof problem_exception_1.ProblemException);
        strict_1.default.equal(r.err.getStatus(), 400);
    });
    (0, node_test_1.it)('잘못된 JSON 은 400 이다 — 서버 고장(500)으로 보이면 같은 요청을 또 보낸다', () => {
        const r = parse(Buffer.from('{bad'));
        strict_1.default.ok(r.err instanceof problem_exception_1.ProblemException);
        strict_1.default.equal(r.err.getStatus(), 400);
    });
    (0, node_test_1.it)('빈 본문은 빈 객체다', () => {
        strict_1.default.deepEqual(parse(Buffer.alloc(0)).value, {});
    });
});
//# sourceMappingURL=strict-json.test.js.map