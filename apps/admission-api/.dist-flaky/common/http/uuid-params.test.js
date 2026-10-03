"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const uuid_params_1 = require("./uuid-params");
(0, node_test_1.describe)('경로 식별자 형식 (형식 오류는 404, 500 이 아니다)', () => {
    (0, node_test_1.it)('UUID 가 아닌 …Id 경로 변수를 찾는다', () => {
        strict_1.default.equal((0, uuid_params_1.malformedIdParam)({ applicationId: 'undefined' }), 'applicationId');
        strict_1.default.equal((0, uuid_params_1.malformedIdParam)({ paymentId: "1' OR '1'='1" }), 'paymentId');
    });
    (0, node_test_1.it)('UUID·식별자가 아닌 변수는 통과시킨다', () => {
        strict_1.default.equal((0, uuid_params_1.malformedIdParam)({ applicationId: '61ec4a28-aa43-4c53-8be4-5ec89e45fb32' }), null);
        strict_1.default.equal((0, uuid_params_1.malformedIdParam)({ provider: 'mock-pg' }), null);
        strict_1.default.equal((0, uuid_params_1.malformedIdParam)(undefined), null);
    });
    (0, node_test_1.it)('쿼리의 UUID 식별자도 DB에 보내기 전에 찾는다', () => {
        strict_1.default.equal((0, uuid_params_1.malformedIdQuery)({ cycleId: 'cycleId' }), 'cycleId');
        strict_1.default.equal((0, uuid_params_1.malformedIdQuery)({ admissionCycleId: 'http://example.com' }), 'admissionCycleId');
        strict_1.default.equal((0, uuid_params_1.malformedIdQuery)({ cycleId: '11111111-1111-1111-1111-111111111111' }), null);
        strict_1.default.equal((0, uuid_params_1.malformedIdQuery)({ limit: '50' }), null);
    });
});
//# sourceMappingURL=uuid-params.test.js.map