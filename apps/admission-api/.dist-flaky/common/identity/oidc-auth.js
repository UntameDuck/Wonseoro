"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OidcAuthenticator = exports.ApplicantDirectory = exports.PUBLIC_ROUTES = void 0;
exports.routeAudience = routeAudience;
exports.installOidcAuthentication = installOidcAuthentication;
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const problem_exception_1 = require("../problem/problem.exception");
const problem_filter_1 = require("../problem/problem.filter");
/** 계약에서 `security: []` 인 지원자 쪽 경로. 토큰 없이 부른다 */
exports.PUBLIC_ROUTES = new Set([
    'GET /api/v1/meta/time',
    'GET /api/v1/meta/operating-mode',
    'GET /api/v1/meta/signing-keys',
    // 모집·전형·모집단위 — 누구에게나 같은 공개 정보, 로그인 전 화면·운영 콘솔이 보인다 (계약 1.7.0, D-65)
    'GET /api/v1/admission-cycles/current',
    'GET /api/v1/admission-types',
    'GET /api/v1/departments',
    // PG 가 부른다 — 신원 대신 서명으로 막는다 (D-40)
    'POST /api/v1/payments/callbacks/:provider',
]);
/** 경로 모양(`/api/v1/applications/:applicationId`)으로 누구의 토큰이 필요한지 */
function routeAudience(method, routeUrl) {
    if (!routeUrl || method === 'OPTIONS')
        return 'none';
    if (routeUrl.startsWith('/admin/v1/'))
        return 'staff';
    if (routeUrl.startsWith('/api/v1/'))
        return exports.PUBLIC_ROUTES.has(`${method} ${routeUrl}`) ? 'public' : 'applicant';
    return 'none';
}
/* ── 지원자 등록 ───────────────────────────────────────────────────── */
/**
 * 지원자 렐름의 주체(sub) → 원서로 지원자 식별자. 처음 오면 만든다 (A9).
 * 실명·주민번호 같은 개인정보는 여기서 받지 않는다 — `pii_ciphertext` 는 비워 두고(`pii_key_version='none'`)
 * 본인확인 기관 연동·필드 암호화(T-M5-06) 때 채운다 (docs/10 G-7).
 */
let ApplicantDirectory = class ApplicantDirectory {
    db;
    cache = new Map();
    constructor(db) {
        this.db = db;
    }
    async resolve(subject) {
        const hit = this.cache.get(subject);
        if (hit)
            return hit;
        // 같은 주체가 동시에 처음 와도 한 행만 생긴다(subject_token UNIQUE)
        await this.db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
       VALUES ($1, $2, '\\x'::bytea, 'none')
       ON CONFLICT (subject_token) DO NOTHING`, [(0, node_crypto_1.randomUUID)(), subject]);
        const { rows } = await this.db.query(`SELECT id FROM applicant WHERE subject_token = $1`, [subject]);
        const id = rows[0]?.id;
        if (!id)
            throw new Error('지원자 등록 직후 행을 찾지 못했다');
        if (this.cache.size >= 50_000)
            this.cache.clear();
        this.cache.set(subject, id);
        return id;
    }
};
exports.ApplicantDirectory = ApplicantDirectory;
exports.ApplicantDirectory = ApplicantDirectory = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db])
], ApplicantDirectory);
/* ── 검증 ──────────────────────────────────────────────────────────── */
const meter = api_1.metrics.getMeter('k-admission.auth');
const decisions = meter.createCounter('auth_decisions', {
    description: '토큰 검증 판정 수 (audience=applicant|staff, result=ok|grace|missing|invalid|unavailable). grace = 발급자 단절 중 만료 토큰을 유예로 받음(D-67)',
});
const jwksAge = meter.createObservableGauge('oidc_jwks_age_seconds', {
    description: '발급자 공개키를 마지막으로 받은 뒤 지난 시간(realm=applicant|staff). 커지면 발급자와 끊긴 것이다(T-M3-06)',
});
let OidcAuthenticator = class OidcAuthenticator {
    applicants;
    logger = new common_1.Logger('auth');
    applicant;
    staff;
    lastGraceLog = 0;
    constructor(applicants) {
        this.applicants = applicants;
        if (!config_1.OIDC)
            throw new Error('AUTH_MODE=oidc 가 아닌데 OIDC 인증기를 만들었다');
        const snapshot = (name) => (config_1.OIDC.jwksSnapshotDir ? (0, node_path_1.join)(config_1.OIDC.jwksSnapshotDir, `jwks-${name}.json`) : undefined);
        // 공개키 조회도 출구 허용 목록을 거친다(T-M5-07) — 발급자 이름이 막힌 주소로 풀리면 받지 않는다
        const fetch = ((url, init) => (0, server_kit_1.egressHttp)().fetch(String(url), init));
        const common = { audience: config_1.OIDC.audience, maxStaleMs: config_1.OIDC.jwksMaxStaleMs, fetch };
        this.applicant = new server_kit_1.OidcVerifier({
            ...common,
            issuer: config_1.OIDC.applicantIssuer,
            snapshotFile: snapshot('applicant'),
            outageGraceMs: config_1.OIDC.applicantOutageGraceMs,
        });
        this.staff = new server_kit_1.OidcVerifier({ ...common, issuer: config_1.OIDC.staffIssuer, snapshotFile: snapshot('staff') });
        jwksAge.addCallback((r) => {
            for (const [realm, v] of [['applicant', this.applicant], ['staff', this.staff]]) {
                const age = v.status().ageMs;
                if (age !== null)
                    r.observe(age / 1000, { realm });
            }
        });
    }
    /** 경로에 맞는 토큰을 검증해 신원을 돌려준다. 토큰이 필요 없는 경로면 null */
    async authenticate(request) {
        const audience = routeAudience(request.method, request.routeOptions?.url);
        if (audience !== 'applicant' && audience !== 'staff')
            return null;
        try {
            const token = server_kit_1.OidcVerifier.bearer(request.headers.authorization);
            const verified = await (audience === 'staff' ? this.staff : this.applicant).verify(token);
            const identity = audience === 'staff' ? staffOf(verified) : await this.applicantOf(verified);
            decisions.add(1, { audience, result: verified.outageGrace ? 'grace' : 'ok' });
            if (verified.outageGrace && Date.now() - this.lastGraceLog > 60_000) {
                // 단절 중에는 요청마다 온다 — 1분에 한 줄만
                this.lastGraceLog = Date.now();
                this.logger.warn(`발급자에 닿지 않아 만료된 ${audience} 토큰을 단절 유예로 받는 중 (D-67)`);
            }
            return identity;
        }
        catch (err) {
            if (err instanceof server_kit_1.OidcUnavailableError) {
                decisions.add(1, { audience, result: 'unavailable' });
                this.logger.error(`발급자 키를 쓸 수 없어 ${audience} 토큰을 판단하지 못함: ${err.message}`);
                throw problem_exception_1.ProblemException.authUnavailable();
            }
            if (err instanceof server_kit_1.OidcTokenError) {
                decisions.add(1, { audience, result: err.problem === 'missing' ? 'missing' : 'invalid' });
                // 토큰 값·주체는 남기지 않는다. 이유만 — trace_id 로 이어서 본다
                if (err.problem !== 'missing')
                    this.logger.warn(`${audience} 토큰 거절: ${err.problem}`);
                throw problem_exception_1.ProblemException.unauthenticated();
            }
            throw err;
        }
    }
    async applicantOf(v) {
        return { kind: 'applicant', applicantId: await this.applicants.resolve(v.subject), subjectToken: v.subject, authTime: v.authTime };
    }
};
exports.OidcAuthenticator = OidcAuthenticator;
exports.OidcAuthenticator = OidcAuthenticator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ApplicantDirectory])
], OidcAuthenticator);
function staffOf(v) {
    const username = v.claims.preferred_username;
    return {
        kind: 'staff',
        adminId: typeof username === 'string' && username.length > 0 ? username : v.subject,
        subject: v.subject,
        roles: v.roles,
        acr: v.acr,
        authTime: v.authTime,
    };
}
/**
 * Fastify 에 건다 — 요청 한도(throttle) 훅보다 **먼저** 걸어야 한다. 한도는 인증된 지원자 기준이다.
 * Nest 예외 필터 밖이라 오류 응답을 여기서 problem+json 으로 직접 쓴다.
 */
function installOidcAuthentication(fastify, authenticator) {
    fastify.decorateRequest('identity', undefined);
    fastify.addHook('onRequest', async (request, reply) => {
        try {
            const identity = await authenticator.authenticate(request);
            if (identity)
                request.identity = identity;
        }
        catch (err) {
            if (!(err instanceof problem_exception_1.ProblemException))
                throw err;
            for (const [name, value] of Object.entries(err.headers))
                reply.header(name, value);
            return reply
                .status(err.problem.status)
                .header('content-type', `${contracts_1.MEDIA_PROBLEM}; charset=utf-8`)
                .header('cache-control', contracts_1.CACHE_CONTROL_PII)
                .send({ ...err.problem, instance: request.url, traceId: (0, problem_filter_1.requestTraceId)(request) });
        }
    });
}
//# sourceMappingURL=oidc-auth.js.map