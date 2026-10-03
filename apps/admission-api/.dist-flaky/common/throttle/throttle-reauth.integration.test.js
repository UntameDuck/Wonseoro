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
const node_crypto_1 = require("node:crypto");
const node_http_1 = require("node:http");
const node_test_1 = require("node:test");
const jose_1 = require("jose");
/**
 * 위험 차단 → 본인확인 다시 하기로 해제 — HTTP (ADR-0009, T-M5-02 단계 6)
 *
 * 실제 조립(app.setup.ts — 인증 훅 다음 요청 한도 훅)과 실제 PostgreSQL. 남의 원서를 훑어 위험점수를 올리면
 * 변경 요청이 429 RATE_LIMITED 로 막히고, 응답이 "다시 본인확인하면 풀린다"(`WWW-Authenticate … insufficient_user_authentication`)를
 * 알린다. 차단 뒤에 직접 인증한 토큰(auth_time)으로 같은 요청을 보내면 통과한다. 차단 전 인증의 토큰은 계속 막힌다.
 */
process.env.AUTH_MODE = 'oidc';
process.env.UNIVERSITY_ID ??= 'UNIV-A';
process.env.THROTTLE_MODE = 'enforce';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';
const CYCLE = '11111111-1111-1111-1111-111111111111';
let key;
let jwk;
let server;
let issuer = '';
let app = null;
let available = false;
const SKIP = 'DATABASE_URL 이 없거나 DB 에 닿지 않는다';
async function token(sub, authAt) {
    const now = Math.floor(Date.now() / 1000);
    return new jose_1.SignJWT({ auth_time: Math.floor(authAt / 1000) })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience('wonseoro-admission-api')
        .setSubject(sub)
        .setIssuedAt(now - 1)
        .setExpirationTime(now + 300)
        .sign(key);
}
async function call(method, url, bearer, body) {
    const res = await app.inject({
        method: method,
        url,
        headers: {
            authorization: `Bearer ${bearer}`,
            ...(body !== undefined ? { 'content-type': method === 'PATCH' ? 'application/merge-patch+json' : 'application/json', 'idempotency-key': `reauth-${(0, node_crypto_1.randomUUID)()}` } : {}),
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: res.statusCode, headers: res.headers, json: (() => { try {
            return res.json();
        }
        catch {
            return {};
        } })() };
}
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    const pair = await (0, jose_1.generateKeyPair)('RS256');
    key = pair.privateKey;
    jwk = { ...(await (0, jose_1.exportJWK)(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = (0, node_http_1.createServer)((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url?.endsWith('/.well-known/openid-configuration'))
            return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/certs` }));
        if (req.url?.endsWith('/certs'))
            return res.end(JSON.stringify({ keys: [jwk] }));
        return res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${server.address().port}/realms/applicant`;
    process.env.OIDC_APPLICANT_ISSUER = issuer;
    process.env.OIDC_STAFF_ISSUER = `http://127.0.0.1:${server.address().port}/realms/staff`;
    const { NestFactory } = await Promise.resolve().then(() => __importStar(require('@nestjs/core')));
    const { FastifyAdapter } = await Promise.resolve().then(() => __importStar(require('@nestjs/platform-fastify')));
    const { AppModule } = await Promise.resolve().then(() => __importStar(require('../../app.module')));
    const { configureHttpApp } = await Promise.resolve().then(() => __importStar(require('../../app.setup')));
    const { Db } = await Promise.resolve().then(() => __importStar(require('@wonseoro/server-kit')));
    app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false, bodyParser: false });
    configureHttpApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    available = await app.get(Db).healthy();
});
(0, node_test_1.after)(async () => {
    await app?.close();
    server?.close();
});
(0, node_test_1.describe)('위험 차단과 본인확인 다시 하기 (ADR-0009)', () => {
    (0, node_test_1.it)('남의 원서를 훑어 막히면 다시 본인확인한 토큰으로 바로 풀린다', async (ctx) => {
        if (!available)
            return ctx.skip(SKIP);
        const sub = `reauth-${(0, node_crypto_1.randomUUID)()}`;
        const loginAt = Date.now() - 10 * 60_000;
        const old = await token(sub, loginAt);
        const made = await call('POST', '/api/v1/applications', old, {
            cycleId: CYCLE, admissionTypeId: '22222222-2222-2222-2222-222222222222', departmentId: '33333333-3333-3333-3333-333333333333',
        });
        strict_1.default.ok(made.status === 201 || made.status === 200, `원서 ${made.status}`);
        const own = made.json.id;
        // 남의(없는) 원서를 훑는다 — 소유권 실패가 위험점수를 올린다
        for (let i = 0; i < 10; i += 1)
            await call('GET', `/api/v1/applications/${(0, node_crypto_1.randomUUID)()}`, old);
        // 변경 요청(원서 저장)이 막힌다 — 조회는 위험점수로 막지 않는다
        const blocked = await call('PATCH', `/api/v1/applications/${own}`, old, {});
        strict_1.default.equal(blocked.status, 429, `막혀야 한다: ${blocked.status}`);
        strict_1.default.equal(blocked.json.code, 'RATE_LIMITED');
        strict_1.default.match(String(blocked.headers['www-authenticate']), /insufficient_user_authentication/, '다시 본인확인하면 풀린다고 알린다');
        strict_1.default.ok(Number(blocked.headers['retry-after']) >= 1, '기다리는 길도 함께');
        // 차단 전 인증의 토큰은 계속 막힌다
        strict_1.default.equal((await call('PATCH', `/api/v1/applications/${own}`, old, {})).status, 429);
        // 다시 본인확인 — 차단 뒤의 auth_time
        await new Promise((r) => setTimeout(r, 1100));
        const fresh = await token(sub, Date.now());
        const released = await call('PATCH', `/api/v1/applications/${own}`, fresh, {});
        strict_1.default.notEqual(released.status, 429, `풀려야 한다: ${released.status} ${JSON.stringify(released.json)}`);
    });
});
//# sourceMappingURL=throttle-reauth.integration.test.js.map