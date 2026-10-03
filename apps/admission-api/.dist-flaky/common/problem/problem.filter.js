"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ProblemFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemFilter = void 0;
exports.isTransientDbSaturation = isTransientDbSaturation;
exports.requestTraceId = requestTraceId;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("./problem.exception");
/**
 * 모든 오류를 application/problem+json 으로 변환한다.
 *
 * 주의: 오류 응답에 개인정보를 넣지 않는다. (v1.0 §15 / v1.1 §B8)
 * 스택 트레이스·요청 본문은 절대 응답에 포함하지 않는다.
 */
let ProblemFilter = ProblemFilter_1 = class ProblemFilter {
    logger = new common_1.Logger(ProblemFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const reply = ctx.getResponse();
        const request = ctx.getRequest();
        const problem = this.toProblem(exception, request);
        if (problem.status >= 500) {
            // 요청 본문·개인정보는 로깅하지 않는다. 원인 규명에 필요한
            // 오류 종류와 메시지만 남긴다. (v1.1 §B8)
            const cause = exception instanceof Error ? `${exception.name}: ${exception.message}` : 'unknown';
            this.logger.error(`${problem.status} ${problem.code} trace=${problem.traceId} ${request.method} ${request.url} cause=${cause}`);
        }
        if (exception instanceof problem_exception_1.ProblemException) {
            for (const [name, value] of Object.entries(exception.headers))
                reply.header(name, value);
        }
        void reply
            .status(problem.status)
            .header('content-type', `${contracts_1.MEDIA_PROBLEM}; charset=utf-8`)
            .header('cache-control', contracts_1.CACHE_CONTROL_PII)
            .send(problem);
    }
    toProblem(exception, request) {
        const traceId = requestTraceId(request);
        if (exception instanceof problem_exception_1.ProblemException) {
            return {
                ...exception.problem,
                instance: request.url,
                traceId: exception.problem.traceId || traceId,
            };
        }
        if (exception instanceof common_1.HttpException) {
            const status = exception.getStatus();
            const code = status === 404 ? contracts_1.ProblemCode.NOT_FOUND : contracts_1.ProblemCode.INTERNAL;
            return {
                type: (0, contracts_1.problemType)(code),
                title: exception.message,
                status,
                code,
                traceId,
                instance: request.url,
            };
        }
        // DB 연결을 기다리다 시간이 다 됐다 — 마감 피크의 일시적 포화다. 500 이 아니라 재시도 안내(503)로 답한다.
        // 변경 요청은 모두 Idempotency-Key 를 쓰고 핵심 변경은 한 트랜잭션이라, 같은 키로 다시 보내도 두 번 반영되지 않는다
        // (T-M4-40 kind 시험에서 확인)
        if (isTransientDbSaturation(exception)) {
            return {
                ...problem_exception_1.ProblemException.retryable('접속이 몰려 잠시 처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.').problem,
                instance: request.url,
                traceId,
            };
        }
        // 필드 암호 키를 쓸 수 없다(KEK 저장소 장애·키 누락) — 원서 내용을 빈 값·평문으로 대신하지 않고 닫는다(T-M5-06).
        // 키가 돌아오면 같은 요청이 된다
        // 쓰기 세대가 맞지 않다(T-M5-63) — 장애 전환 중이다. 새 Primary·새 세대가 퍼지면 같은 요청이 된다
        if (exception instanceof Error && /writer fenced/.test(exception.message)) {
            return {
                ...problem_exception_1.ProblemException.retryable('지금은 저장할 수 없습니다. 잠시 후 다시 시도해 주십시오.').problem,
                instance: request.url,
                traceId,
            };
        }
        if (exception instanceof server_kit_1.FieldKeyUnavailable) {
            return {
                ...problem_exception_1.ProblemException.retryable('지금은 원서 내용을 불러올 수 없습니다. 잠시 후 다시 시도해 주십시오.').problem,
                instance: request.url,
                traceId,
            };
        }
        return {
            type: (0, contracts_1.problemType)(contracts_1.ProblemCode.INTERNAL),
            title: '서버 내부 오류가 발생했습니다',
            status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
            code: contracts_1.ProblemCode.INTERNAL,
            traceId,
            instance: request.url,
        };
    }
};
exports.ProblemFilter = ProblemFilter;
exports.ProblemFilter = ProblemFilter = ProblemFilter_1 = __decorate([
    (0, common_1.Catch)()
], ProblemFilter);
/**
 * 연결 풀 포화 — pg-pool 이 connectionTimeoutMillis 안에 연결을 못 준 경우, PgBouncer 가 클라이언트 상한으로
 * 거절한 경우. 그 쿼리는 연결을 얻지 못해 실행되지 않았다.
 */
function isTransientDbSaturation(error) {
    if (!(error instanceof Error))
        return false;
    // 노드 장애로 끊긴 연결(쿼리 시간 초과·연결 종료)도 같다 — 연결은 버려졌고 다음 시도는 새 연결로 간다 (T-M4-39)
    return /timeout exceeded when trying to connect|no more connections allowed|too many clients already|Query read timeout|Connection terminated/i.test(error.message);
}
/** traceparent: 00-<trace-id>-<span-id>-<flags>. Nest 밖(Fastify 훅)에서 만든 problem 도 같은 값을 쓴다. */
function requestTraceId(request) {
    const tp = request.headers[contracts_1.HEADER_TRACEPARENT];
    if (typeof tp === 'string') {
        const parts = tp.split('-');
        if (parts[1])
            return parts[1];
    }
    const rid = request.headers[contracts_1.HEADER_REQUEST_ID];
    if (typeof rid === 'string' && rid)
        return rid;
    return request.id ?? '';
}
//# sourceMappingURL=problem.filter.js.map