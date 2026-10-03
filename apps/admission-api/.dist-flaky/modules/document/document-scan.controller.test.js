"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const document_scan_controller_1 = require("./document-scan.controller");
(0, node_test_1.describe)('검사 대기 목록 개수', () => {
    (0, node_test_1.it)('생략하면 50, 상한을 넘으면 200이다', () => {
        strict_1.default.equal((0, document_scan_controller_1.parseScanLimit)(), 50);
        strict_1.default.equal((0, document_scan_controller_1.parseScanLimit)('250'), 200);
    });
    (0, node_test_1.it)('숫자가 아니거나 1보다 작으면 DB에 보내지 않는다', () => {
        for (const value of ['NaN', 'http://example.com', '0', '-1', '1.5']) {
            strict_1.default.throws(() => (0, document_scan_controller_1.parseScanLimit)(value));
        }
    });
});
//# sourceMappingURL=document-scan.controller.test.js.map