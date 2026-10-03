"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applicantFrom = applicantFrom;
exports.adminFrom = adminFrom;
const config_1 = require("../../config");
const problem_exception_1 = require("../problem/problem.exception");
/** 게이트웨이가 검증 후 넣어주는 헤더. 브라우저가 직접 보낼 수 없도록 Edge 에서 제거한다. */
const GATEWAY_APPLICANT = 'x-authenticated-applicant';
const GATEWAY_ADMIN = 'x-authenticated-admin';
function header(req, name) {
    const v = req.headers[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function applicantFrom(req) {
    if (config_1.AUTH_MODE === 'oidc') {
        const identity = req.identity;
        // 훅이 이 경로에 지원자 토큰을 요구한다. 없으면 열지 않는다(경로 분류가 틀렸을 때의 마지막 문)
        if (identity?.kind !== 'applicant')
            throw problem_exception_1.ProblemException.unauthenticated();
        return { applicantId: identity.applicantId, subjectToken: identity.subjectToken };
    }
    const id = config_1.AUTH_MODE === 'gateway'
        ? header(req, GATEWAY_APPLICANT)
        : header(req, 'x-applicant-id');
    if (!id)
        throw problem_exception_1.ProblemException.forbidden('지원자를 식별할 수 없습니다.');
    const subjectToken = config_1.AUTH_MODE === 'gateway' ? header(req, 'x-authenticated-subject') : header(req, 'x-subject-token');
    return { applicantId: id, ...(subjectToken ? { subjectToken } : {}) };
}
function adminFrom(req) {
    if (config_1.AUTH_MODE === 'oidc') {
        const identity = req.identity;
        if (identity?.kind !== 'staff')
            throw problem_exception_1.ProblemException.unauthenticated();
        // 2인 승인의 "다른 사람" 판단·감사의 행위자 — 토큰의 담당자다. 화면이 보낸 이름은 쓰지 않는다
        return { adminId: identity.adminId };
    }
    const id = config_1.AUTH_MODE === 'gateway' ? header(req, GATEWAY_ADMIN) : header(req, 'x-admin-id');
    if (!id)
        throw problem_exception_1.ProblemException.forbidden('운영자를 식별할 수 없습니다.');
    return { adminId: id };
}
//# sourceMappingURL=identity.js.map