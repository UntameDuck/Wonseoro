"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_ROUTES = void 0;
exports.internalDecision = internalDecision;
exports.installInternalAuth = installInternalAuth;
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const problem_filter_1 = require("../problem/problem.filter");
/** 경로 → 부를 수 있는 워크로드(이 대학의 것만) */
exports.INTERNAL_ROUTES = {
    'GET /internal/v1/documents/pending-scan': ['document-service'],
    'POST /internal/v1/documents/:documentId/scan-result': ['document-service'],
};
const decisions = api_1.metrics.getMeter('k-admission.auth').createCounter('internal_auth_decisions', {
    description: '내부 경로 상호 TLS 판정 수 (result=ok|no-certificate|untrusted|no-identity|forbidden|plaintext)',
});
/** 어느 워크로드가 이 경로를 부를 수 있나 — 신원이 없으면 401, 있지만 아니면 403 */
function internalDecision(method, url, identity) {
    if (!identity)
        return 401;
    const allowed = exports.INTERNAL_ROUTES[`${method} ${url}`];
    if (!allowed || identity.zone !== 'university' || identity.universityId !== config_1.UNIVERSITY_ID || !allowed.includes(identity.workload))
        return 403;
    return 'ok';
}
function installInternalAuth(fastify) {
    const logger = new common_1.Logger('internal-auth');
    fastify.decorateRequest('internalPeer', null);
    fastify.addHook('onRequest', async (request, reply) => {
        const url = request.routeOptions?.url;
        if (!url?.startsWith('/internal/') || config_1.INTERNAL.mode !== 'mtls')
            return;
        const { identity, problem } = (0, server_kit_1.peerIdentity)(request.raw.socket);
        const decision = internalDecision(request.method, url, identity);
        decisions.add(1, { route: url, result: decision === 'ok' ? 'ok' : decision === 401 ? (problem ?? 'no-identity') : 'forbidden' });
        if (decision === 'ok') {
            request.internalPeer = identity;
            return;
        }
        logger.warn(`내부 경로 거절 ${request.method} ${url} — ${decision === 401 ? problem : 'forbidden'}${identity ? ` (${identity.uri})` : ''}`);
        const [code, title, detail] = decision === 401
            ? [contracts_1.ProblemCode.UNAUTHENTICATED, '내부 호출 인증이 필요합니다', '플랫폼이 발급한 워크로드 인증서로 다시 연결해 주십시오.']
            : [contracts_1.ProblemCode.FORBIDDEN, '이 경로를 부를 수 없는 워크로드입니다', '이 경로는 이 대학의 정해진 워크로드만 부를 수 있습니다.'];
        return reply
            .status(decision)
            .header('content-type', `${contracts_1.MEDIA_PROBLEM}; charset=utf-8`)
            .header('cache-control', contracts_1.CACHE_CONTROL_PII)
            .send({ type: (0, contracts_1.problemType)(code), title, status: decision, code, detail, instance: request.url, traceId: (0, problem_filter_1.requestTraceId)(request) });
    });
}
//# sourceMappingURL=internal-auth.js.map