"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const yaml_1 = require("yaml");
const server_kit_1 = require("@wonseoro/server-kit");
// 설정은 모듈을 불러올 때 읽힌다 — 대학 ID 를 먼저 정하고 불러온다(CI 의 단위 시험 단계에는 UNIVERSITY_ID 가 없다)
process.env.UNIVERSITY_ID ??= 'UNIV-A';
const UNIVERSITY_ID = process.env.UNIVERSITY_ID;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { INTERNAL_ROUTES, internalDecision } = require('./internal-auth');
/**
 * 내부 경로 상호 TLS — 대학 API (T-M5-05·09, D-69)
 *   ① 계약에서 mutualTLS 를 요구하는 대학 API 경로가 모두 표에 있다(빠지면 인증 없이 열린다)
 *   ② 같은 대학의 서류 워커만 — 다른 워크로드·다른 대학·신원 없음은 거절
 */
const ROOT = (0, node_path_1.resolve)(__dirname, '../../../../..');
const OPENAPI = (0, yaml_1.parse)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8'));
const id = (uri) => (0, server_kit_1.parseWorkloadUri)(uri);
(0, node_test_1.describe)('대학 API 내부 경로 — 계약의 mutualTLS', () => {
    (0, node_test_1.it)('계약의 대학 API mutualTLS 경로가 모두 표에 있고, 표에는 그것뿐이다', () => {
        const contract = Object.entries(OPENAPI.paths)
            .filter(([p]) => p.startsWith('/internal/v1/documents'))
            .flatMap(([p, ops]) => Object.entries(ops)
            .filter(([, op]) => op.security?.some((s) => 'mutualTLS' in s))
            .map(([m]) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`))
            .sort();
        strict_1.default.deepEqual(Object.keys(INTERNAL_ROUTES).sort(), contract);
    });
    (0, node_test_1.it)('같은 대학의 서류 워커만 통과한다', () => {
        const route = ['GET', '/internal/v1/documents/pending-scan'];
        strict_1.default.equal(internalDecision(...route, id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/document-service`)), 'ok');
        strict_1.default.equal(internalDecision(...route, null), 401);
        strict_1.default.equal(internalDecision(...route, id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/event-relay`)), 403);
        strict_1.default.equal(internalDecision(...route, id('spiffe://wonseoro/university/UNIV-Z/document-service')), 403);
        strict_1.default.equal(internalDecision(...route, id('spiffe://wonseoro/central/document-service')), 403);
        strict_1.default.equal(internalDecision('GET', '/internal/v1/unknown', id(`spiffe://wonseoro/university/${UNIVERSITY_ID}/document-service`)), 403);
    });
});
//# sourceMappingURL=internal-auth.test.js.map