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
const common_1 = require("@nestjs/common");
const constants_1 = require("@nestjs/common/constants");
const yaml_1 = require("yaml");
const app_module_1 = require("../../app.module");
const admin_scope_1 = require("./admin-scope");
const oidc_auth_1 = require("./oidc-auth");
/**
 * 인증 경로 분류·운영 API 권한을 계약(OpenAPI)과 구조로 대조한다 — T-M5-02, STRIDE E-03
 *
 * 사람이 표를 맞추면 하나는 빠진다(D-28 소유권 검사 누락이 그랬다). 그래서 실제 AppModule 의 컨트롤러를
 * 훑어 모든 경로에 대해 확인한다.
 *   ① 경로 분류(routeAudience)가 계약의 security 와 같다 — `[]` 는 토큰 없이, `oidc: [scope]` 는 담당자, 전역은 지원자
 *   ② 운영 경로마다 @AdminScope 가 있고 계약의 범위와 같다
 *   ③ 재인증(@StepUp) 경로가 정한 목록과 같다 — 늘리거나 빼면 여기서 결정을 다시 본다
 */
const ROOT = (0, node_path_1.resolve)(__dirname, '../../../../..');
const OPENAPI = (0, yaml_1.parse)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(ROOT, 'packages/contracts/openapi/k-admission.v1.yaml'), 'utf8'));
const METHOD_NAME = {
    [common_1.RequestMethod.GET]: 'GET',
    [common_1.RequestMethod.POST]: 'POST',
    [common_1.RequestMethod.PUT]: 'PUT',
    [common_1.RequestMethod.PATCH]: 'PATCH',
    [common_1.RequestMethod.DELETE]: 'DELETE',
};
function controllersOf(module, seen = new Set()) {
    if (!module || seen.has(module))
        return [];
    seen.add(module);
    const own = (Reflect.getMetadata(constants_1.MODULE_METADATA.CONTROLLERS, module) ?? []);
    const imports = (Reflect.getMetadata(constants_1.MODULE_METADATA.IMPORTS, module) ?? []);
    return [...own, ...imports.flatMap((m) => controllersOf(m?.module ?? m, seen))];
}
const join = (...parts) => `/${parts.map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;
function routes() {
    const out = [];
    for (const ctrl of controllersOf(app_module_1.AppModule)) {
        const prefix = (Reflect.getMetadata(constants_1.PATH_METADATA, ctrl) ?? '');
        const classScope = Reflect.getMetadata(admin_scope_1.ADMIN_SCOPE_KEY, ctrl);
        const proto = ctrl.prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
            const fn = proto[name];
            if (name === 'constructor' || typeof fn !== 'function')
                continue;
            const method = Reflect.getMetadata(constants_1.METHOD_METADATA, fn);
            if (method === undefined)
                continue;
            const sub = (Reflect.getMetadata(constants_1.PATH_METADATA, fn) ?? '');
            out.push({
                method: METHOD_NAME[method] ?? String(method),
                url: join(prefix, sub),
                scope: Reflect.getMetadata(admin_scope_1.ADMIN_SCOPE_KEY, fn) ?? classScope,
                stepUp: Reflect.getMetadata(admin_scope_1.STEP_UP_KEY, fn) === true,
            });
        }
    }
    return out;
}
/** 계약 경로(`{id}`) → Fastify 모양(`:id`) */
const fastifyPath = (p) => p.replace(/\{([^}]+)\}/g, ':$1');
function contractOps() {
    const map = new Map();
    for (const [path, ops] of Object.entries(OPENAPI.paths)) {
        for (const [method, op] of Object.entries(ops)) {
            if (!op?.operationId)
                continue;
            map.set(`${method.toUpperCase()} ${fastifyPath(path)}`, { security: op.security });
        }
    }
    return map;
}
const ALL = routes();
const CONTRACT = contractOps();
(0, node_test_1.describe)('인증 경로 분류 — 계약과 같다 (T-M5-02)', () => {
    (0, node_test_1.it)('컨트롤러를 실제로 훑었다', () => {
        strict_1.default.ok(ALL.length >= 40, `경로가 너무 적다: ${ALL.length}`);
        strict_1.default.ok(ALL.some((r) => r.url === '/admin/v1/config/active'));
    });
    (0, node_test_1.it)('계약에 있는 경로는 security 대로 분류된다', () => {
        const wrong = [];
        for (const r of ALL) {
            const op = CONTRACT.get(`${r.method} ${r.url}`);
            if (!op)
                continue;
            const sec = op.security;
            const expected = sec === undefined
                ? 'applicant'
                : sec.length === 0
                    ? r.url.startsWith('/api/v1/')
                        ? 'public'
                        : 'none'
                    : sec.some((s) => 'oidc' in s)
                        ? 'staff'
                        : 'none'; // mutualTLS
            const actual = (0, oidc_auth_1.routeAudience)(r.method, r.url);
            if (actual !== expected)
                wrong.push(`${r.method} ${r.url}: 계약 ${expected} · 분류 ${actual}`);
        }
        strict_1.default.deepEqual(wrong, []);
    });
    (0, node_test_1.it)('계약에 없는 지원자 경로도 기본은 토큰 필요다(닫힌 기본값)', () => {
        for (const r of ALL.filter((x) => x.url.startsWith('/api/v1/') && !CONTRACT.has(`${x.method} ${x.url}`))) {
            strict_1.default.equal((0, oidc_auth_1.routeAudience)(r.method, r.url), 'applicant', `${r.method} ${r.url}`);
        }
    });
    (0, node_test_1.it)('공개 경로 목록이 실제 경로를 가리킨다(오타로 비어 있지 않다)', () => {
        for (const key of oidc_auth_1.PUBLIC_ROUTES)
            strict_1.default.ok(ALL.some((r) => `${r.method} ${r.url}` === key), key);
    });
});
(0, node_test_1.describe)('운영 API 권한 — 계약 범위와 같다 (T-M5-10, STRIDE E-03)', () => {
    const admin = ALL.filter((r) => r.url.startsWith('/admin/v1/'));
    (0, node_test_1.it)('모든 운영 경로에 권한 범위가 붙어 있다', () => {
        strict_1.default.deepEqual(admin.filter((r) => !r.scope).map((r) => `${r.method} ${r.url}`), []);
    });
    (0, node_test_1.it)('권한 범위가 계약의 oidc 범위와 같다', () => {
        const wrong = [];
        for (const r of admin) {
            const op = CONTRACT.get(`${r.method} ${r.url}`);
            // 계약에 없는 운영 경로(D-22 마감 활성화)는 같은 묶음의 범위(admin)를 쓴다
            const expected = op?.security?.find((s) => 'oidc' in s)?.oidc?.[0] ?? 'admin';
            if (r.scope !== expected)
                wrong.push(`${r.method} ${r.url}: 계약 ${expected} · 코드 ${r.scope}`);
        }
        strict_1.default.deepEqual(wrong, []);
    });
    (0, node_test_1.it)('재인증(Step-up) 경로 — 승인·활성화·되돌리기·연장·대사 예외 해결·증적 열람', () => {
        const stepUp = admin.filter((r) => r.stepUp).map((r) => `${r.method} ${r.url}`).sort();
        strict_1.default.deepEqual(stepUp, [
            'GET /admin/v1/evidence/applications/:applicationId',
            'POST /admin/v1/config/versions/:configId/activate',
            'POST /admin/v1/config/versions/:configId/approve',
            'POST /admin/v1/config/versions/:configId/rollback',
            'POST /admin/v1/deadline-policies/:policyId/activate',
            'POST /admin/v1/deadline-policies/:policyId/approve',
            'POST /admin/v1/deadline-policies/extensions',
            'POST /admin/v1/reconciliation/:exceptionId/resolve',
        ]);
    });
    (0, node_test_1.it)('지원자 경로에는 운영 권한 표시가 없다', () => {
        strict_1.default.deepEqual(ALL.filter((r) => !r.url.startsWith('/admin/v1/') && (r.scope || r.stepUp)).map((r) => r.url), []);
    });
});
//# sourceMappingURL=oidc-routes.test.js.map