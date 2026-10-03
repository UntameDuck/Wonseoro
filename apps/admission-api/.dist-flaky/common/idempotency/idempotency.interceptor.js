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
exports.IdempotencyInterceptor = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const core_1 = require("@nestjs/core");
const node_crypto_1 = require("node:crypto");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const contracts_1 = require("@wonseoro/contracts");
const problem_exception_1 = require("../problem/problem.exception");
const external_callback_decorator_1 = require("./external-callback.decorator");
const idempotency_store_1 = require("./idempotency.store");
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음. (v1.1 §B12)
 *
 * 동작
 *   키 없음 / 길이 위반      → 400
 *   최초 요청                → 처리 후 응답을 레코드에 저장
 *   같은 키 + 같은 요청       → 저장된 응답을 그대로 재생 (상태를 다시 바꾸지 않는다)
 *   같은 키 + 다른 요청       → 409 idempotency-key-reused
 *   같은 키 + 처리 중         → 503 재시도 유도. 중복 실행보다 거절이 낫다
 *
 * ⚠️ applicationId 가 경로에 없는 요청(POST /applications)은 레코드를 남기지 않는다.
 * DDL 의 idempotency_record.application_id 가 NOT NULL 이기 때문이다. (D-12)
 * 생성 중복은 application 의 자연키 UNIQUE 제약이 막는다.
 */
let IdempotencyInterceptor = class IdempotencyInterceptor {
    store;
    reflector;
    logger = new common_1.Logger('idempotency');
    constructor(store, reflector = new core_1.Reflector()) {
        this.store = store;
        this.reflector = reflector;
    }
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        if (!MUTATION_METHODS.has(request.method)) {
            return next.handle();
        }
        // PG 콜백처럼 외부가 부르는 경로. 자기 이벤트 ID 로 중복을 막는다.
        if (this.reflector.get(external_callback_decorator_1.EXTERNAL_CALLBACK, context.getHandler())) {
            return next.handle();
        }
        const key = this.requireKey(request);
        return (0, rxjs_1.from)(this.applicationId(request)).pipe((0, rxjs_1.switchMap)((applicationId) => {
            // 원서를 알 수 없으면(원서 생성·운영 API) 저장소를 쓰지 않는다. 헤더 검증은 그대로 수행했다.
            if (!applicationId)
                return next.handle();
            return this.guarded(context, next, {
                applicationId,
                operation: this.operation(request),
                key,
            });
        }));
    }
    guarded(context, next, scope) {
        const request = context.switchToHttp().getRequest();
        const requestHash = hashRequest(request);
        return (0, rxjs_1.from)(this.store.acquire(scope, requestHash)).pipe((0, rxjs_1.switchMap)((existing) => {
            if (existing) {
                if (existing.requestHash !== requestHash) {
                    throw problem_exception_1.ProblemException.idempotencyKeyReused();
                }
                if (existing.state === 'PROCESSING') {
                    throw problem_exception_1.ProblemException.retryable('같은 요청이 처리 중입니다. 잠시 후 다시 확인해 주십시오.');
                }
                if (existing.state === 'COMPLETED') {
                    // 저장된 응답 재생 — 핸들러를 다시 실행하지 않는다.
                    // 상태코드도 함께 복원한다. 복원하지 않으면 재시도가 201(신규 생성)로
                    // 보여 OpenAPI 계약(200=재시도, 201=신규)을 어긴다.
                    if (typeof existing.responseStatus === 'number') {
                        context
                            .switchToHttp()
                            .getResponse()
                            .status(existing.responseStatus);
                    }
                    return (0, rxjs_1.of)(existing.responseBody);
                }
                // FAILED: 같은 키로 재시도를 허용하지 않는다. 새 키를 쓰게 한다.
                throw problem_exception_1.ProblemException.idempotencyKeyReused();
            }
            return next.handle().pipe((0, operators_1.tap)({
                next: (body) => {
                    const status = context.switchToHttp().getResponse().statusCode ?? 200;
                    this.record(this.store.complete(scope, status, body), 'complete');
                },
                error: () => {
                    this.record(this.store.fail(scope), 'fail');
                },
            }));
        }));
    }
    /**
     * 응답 기록은 기다리지 않는다 — 요청은 이미 커밋됐고, 기록이 늦거나 실패해도 그 결과를 바꾸지 않는다.
     * 다만 실패를 잡지 않으면 처리되지 않은 Promise 거부로 **프로세스가 죽는다.** 마감 피크에 DB 풀이 잠깐
     * 모자라자 이 한 줄 때문에 API Pod 두 개가 연달아 재시작했다(T-M4-40 kind 시험). 기록을 못 한 요청을
     * 같은 키로 재시도하면 PROCESSING 으로 보여 재시도 안내(503)를 받는다 — 중복 실행보다 낫다.
     */
    record(write, what) {
        write.catch((err) => {
            this.logger.warn(`idempotency ${what} not recorded (${(0, server_kit_1.describeFailure)(err)})`);
        });
    }
    requireKey(request) {
        const key = request.headers[contracts_1.HEADER_IDEMPOTENCY_KEY];
        if (typeof key !== 'string' || key.trim() === '') {
            throw problem_exception_1.ProblemException.idempotencyKeyRequired();
        }
        // OpenAPI #/components/parameters/IdempotencyKey: minLength 16, maxLength 200
        if (key.length < contracts_1.IDEMPOTENCY_KEY_MIN_LENGTH || key.length > contracts_1.IDEMPOTENCY_KEY_MAX_LENGTH) {
            throw problem_exception_1.ProblemException.idempotencyKeyInvalid(`Idempotency-Key 길이는 ${contracts_1.IDEMPOTENCY_KEY_MIN_LENGTH}~${contracts_1.IDEMPOTENCY_KEY_MAX_LENGTH}자여야 합니다.`);
        }
        return key;
    }
    /**
     * 요청이 어느 원서의 것인가. 경로에 원서가 있으면 그것, 결제·서류 경로면 그 결제·서류의 원서.
     * 결제 확인·서류 완료·삭제도 같은 키로 재시도하면 같은 응답을 받아야 한다 — 전에는 원서 ID 가
     * 경로에 없다는 이유로 기록하지 않아, 재시도가 두 번 실행되거나 다른 오류로 돌아왔다.
     */
    async applicationId(request) {
        const params = request.params ?? {};
        // 형식이 틀린 원서 ID 는 기록하지 않는다 — DB 에 넘기면 uuid 변환 오류로 500 이 된다.
        // 핸들러의 소유권 검사가 404 로 답한다.
        if (params.applicationId)
            return UUID.test(params.applicationId) ? params.applicationId : null;
        // 내부 경로(검사 워커의 결과 보고)는 제외한다. 워커는 서류마다 고정 키를 쓰는데, 일시 오류로
        // 기록이 FAILED 가 되면 같은 키가 영원히 거절돼 서류가 검사 대기에 묶인다. 그 경로는
        // "QUARANTINED 일 때만" 조건부 전이로 중복을 막는다.
        if (!request.url.startsWith('/api/'))
            return null;
        if (params.paymentId || params.documentId) {
            return this.store.applicationOf({
                ...(params.paymentId ? { paymentId: params.paymentId } : {}),
                ...(params.documentId ? { documentId: params.documentId } : {}),
            });
        }
        return null;
    }
    /** 같은 키를 다른 작업에 재사용해도 서로 간섭하지 않게 한다. */
    operation(request) {
        const url = request.url.split('?')[0] ?? '';
        const tail = url.split('/').pop() ?? 'root';
        return `${request.method}:${tail}`.slice(0, 64);
    }
};
exports.IdempotencyInterceptor = IdempotencyInterceptor;
exports.IdempotencyInterceptor = IdempotencyInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [idempotency_store_1.IdempotencyStore,
        core_1.Reflector])
], IdempotencyInterceptor);
/**
 * 요청 지문. method + path + body 를 정규화해 해시한다.
 * 키 값 자체는 해시에 넣지 않는다 (같은 키로 다른 요청이 온 경우를 잡아야 하므로).
 */
function hashRequest(request) {
    const payload = JSON.stringify({
        method: request.method,
        url: request.url.split('?')[0],
        body: canonical(request.body),
    });
    return (0, node_crypto_1.createHash)('sha256').update(payload).digest('hex');
}
/** 키 순서가 달라도 같은 요청으로 취급하도록 정렬한다. */
function canonical(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(canonical);
    return Object.keys(value)
        .sort()
        .reduce((acc, k) => {
        acc[k] = canonical(value[k]);
        return acc;
    }, {});
}
//# sourceMappingURL=idempotency.interceptor.js.map