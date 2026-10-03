"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
/**
 * HTTP 조립 시험 — 브라우저 사전 요청(CORS preflight)이 계약의 모든 메서드를 허용하는가 (D-66)
 *
 * NestJS 11(@fastify/cors 11)은 허용 메서드 기본값이 GET·HEAD·POST 다. 조립에서 적지 않으면 지원자 화면이
 * 원서 저장(PATCH)·서류 삭제(DELETE)를 브라우저에서 보낼 수 없는데, 서버 대 서버 시험은 사전 요청을 하지 않아 못 잡는다.
 * 실제 조립(app.setup.ts)으로 사전 요청을 보내 본다. DB 없이 돈다.
 */
process.env.UNIVERSITY_ID ??= 'UNIV-CORS';
process.env.CORS_ORIGINS = 'http://localhost:4001';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';
let app;
(0, node_test_1.before)(async () => {
    const { NestFactory } = await Promise.resolve().then(() => __importStar(require('@nestjs/core')));
    const { FastifyAdapter } = await Promise.resolve().then(() => __importStar(require('@nestjs/platform-fastify')));
    const { AppModule } = await Promise.resolve().then(() => __importStar(require('./app.module')));
    const { configureHttpApp } = await Promise.resolve().then(() => __importStar(require('./app.setup')));
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false, bodyParser: false });
    configureHttpApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
});
(0, node_test_1.after)(async () => {
    await app?.close();
});
(0, node_test_1.describe)('브라우저 사전 요청 (D-66)', () => {
    for (const [method, url] of [
        ['PATCH', '/api/v1/applications/00000000-0000-4000-8000-000000000000'],
        ['DELETE', '/api/v1/documents/00000000-0000-4000-8000-000000000000'],
        ['POST', '/api/v1/applications'],
    ]) {
        (0, node_test_1.it)(`지원자 화면 오리진의 ${method} 를 허용한다`, async () => {
            const res = await app.inject({
                method: 'OPTIONS',
                url,
                headers: {
                    origin: 'http://localhost:4001',
                    'access-control-request-method': method,
                    'access-control-request-headers': 'content-type,idempotency-key,if-match',
                },
            });
            strict_1.default.ok(res.statusCode < 300, `${res.statusCode}`);
            strict_1.default.equal(res.headers['access-control-allow-origin'], 'http://localhost:4001');
            strict_1.default.ok(String(res.headers['access-control-allow-methods']).split(',').map((m) => m.trim()).includes(method), String(res.headers['access-control-allow-methods']));
        });
    }
    (0, node_test_1.it)('다른 오리진에는 허용하지 않는다', async () => {
        const res = await app.inject({
            method: 'OPTIONS',
            url: '/api/v1/applications',
            headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
        });
        strict_1.default.notEqual(res.headers['access-control-allow-origin'], 'https://evil.example');
    });
});
//# sourceMappingURL=app.setup.test.js.map