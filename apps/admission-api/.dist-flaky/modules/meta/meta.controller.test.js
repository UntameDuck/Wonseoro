"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const meta_controller_1 = require("./meta.controller");
(0, node_test_1.describe)('서버 시각 모집 선택', () => {
    (0, node_test_1.it)('모집 ID를 생략하면 현재 열린 모집의 정책을 사용한다', async () => {
        const seen = [];
        const db = {
            query: async () => ({ rows: [{ id: '11111111-1111-1111-1111-111111111111' }] }),
        };
        const deadline = {
            snapshot: async (cycleId) => {
                seen.push(cycleId);
                return { cycleId };
            },
        };
        const result = await new meta_controller_1.MetaController(deadline, db).time();
        strict_1.default.deepEqual(seen, ['11111111-1111-1111-1111-111111111111']);
        strict_1.default.deepEqual(result, { cycleId: '11111111-1111-1111-1111-111111111111' });
    });
    (0, node_test_1.it)('명시한 모집 ID는 그대로 사용하고 현재 모집을 다시 조회하지 않는다', async () => {
        const db = { query: async () => strict_1.default.fail('DB 조회를 하면 안 된다') };
        const deadline = { snapshot: async (cycleId) => cycleId };
        const cycleId = '22222222-2222-2222-2222-222222222222';
        strict_1.default.equal(await new meta_controller_1.MetaController(deadline, db).time(cycleId), cycleId);
    });
    (0, node_test_1.it)('열린 모집이 없으면 404로 답한다', async () => {
        const db = { query: async () => ({ rows: [] }) };
        const deadline = { snapshot: async () => strict_1.default.fail('정책을 조회하면 안 된다') };
        await strict_1.default.rejects(new meta_controller_1.MetaController(deadline, db).time(), (error) => {
            return error.problem?.status === 404;
        });
    });
});
//# sourceMappingURL=meta.controller.test.js.map