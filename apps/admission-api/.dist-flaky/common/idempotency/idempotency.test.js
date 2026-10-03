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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const idempotency_store_1 = require("./idempotency.store");
const scope = (key, operation = 'POST:finalize') => ({
    applicationId: '55555555-5555-5555-5555-555555555555',
    operation,
    key,
});
(0, node_test_1.describe)('Idempotency Store (v1.1 §B12 / §01 E 인수기준)', () => {
    (0, node_test_1.it)('처음 보는 키는 선점되고 null 을 반환한다', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        strict_1.default.equal(await store.acquire(scope('k1'), 'hash-a'), null);
    });
    (0, node_test_1.it)('같은 키를 다시 잡으면 PROCESSING 레코드를 반환한다', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        await store.acquire(scope('k1'), 'hash-a');
        const second = await store.acquire(scope('k1'), 'hash-a');
        strict_1.default.ok(second);
        strict_1.default.equal(second.state, 'PROCESSING');
    });
    (0, node_test_1.it)('완료 후에는 저장된 응답을 돌려준다', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        await store.acquire(scope('k1'), 'hash-a');
        await store.complete(scope('k1'), 201, { submissionId: 'sub-1' });
        const replay = await store.acquire(scope('k1'), 'hash-a');
        strict_1.default.ok(replay);
        strict_1.default.equal(replay.state, 'COMPLETED');
        strict_1.default.equal(replay.responseStatus, 201);
        strict_1.default.deepEqual(replay.responseBody, { submissionId: 'sub-1' });
    });
    (0, node_test_1.it)('같은 키에 다른 요청이 오면 지문 불일치로 드러난다', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        await store.acquire(scope('k1'), 'hash-a');
        const conflict = await store.acquire(scope('k1'), 'hash-b');
        strict_1.default.ok(conflict);
        // 인터셉터는 이 불일치를 409 idempotency-key-reused 로 변환한다.
        strict_1.default.equal(conflict.requestHash, 'hash-a');
        strict_1.default.notEqual(conflict.requestHash, 'hash-b');
    });
    (0, node_test_1.it)('실패는 삭제가 아니라 FAILED 로 남는다 (D-11)', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        await store.acquire(scope('k1'), 'hash-a');
        await store.fail(scope('k1'));
        const after = await store.acquire(scope('k1'), 'hash-a');
        strict_1.default.ok(after);
        strict_1.default.equal(after.state, 'FAILED');
    });
    (0, node_test_1.it)('같은 키라도 작업이 다르면 간섭하지 않는다', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        await store.acquire(scope('same-key', 'POST:finalize'), 'h');
        const other = await store.acquire(scope('same-key', 'PATCH:applications'), 'h');
        strict_1.default.equal(other, null, '다른 operation 은 별도 레코드여야 한다');
    });
    (0, node_test_1.it)('동일 키 100회 요청에서 실행은 1회뿐이다 — Submission 1건 보장의 근거', async () => {
        const store = new idempotency_store_1.InMemoryIdempotencyStore();
        let executions = 0;
        const handle = async () => {
            const existing = await store.acquire(scope('finalize-key'), 'hash-a');
            if (existing)
                return existing.responseBody ?? { replayed: true };
            executions += 1;
            const body = { submissionId: 'sub-1', applicationNumber: '2027-A-000001' };
            await store.complete(scope('finalize-key'), 201, body);
            return body;
        };
        const results = await Promise.all(Array.from({ length: 100 }, () => handle()));
        strict_1.default.equal(executions, 1, '핸들러는 정확히 한 번만 실행되어야 한다');
        strict_1.default.equal(results.length, 100);
    });
});
(0, node_test_1.describe)('Idempotency 인터셉터 — 응답 기록 실패가 프로세스를 죽이지 않는다 (T-M4-40 에서 발견)', () => {
    (0, node_test_1.it)('complete 가 실패해도 응답은 그대로 나가고, 처리되지 않은 Promise 거부가 생기지 않는다', async () => {
        const { IdempotencyInterceptor } = await Promise.resolve().then(() => __importStar(require('./idempotency.interceptor')));
        const { lastValueFrom, of } = await Promise.resolve().then(() => __importStar(require('rxjs')));
        class FlakyStore extends idempotency_store_1.InMemoryIdempotencyStore {
            async complete() {
                throw new Error('timeout exceeded when trying to connect');
            }
        }
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const request = {
            method: 'PATCH',
            url: '/api/v1/applications/55555555-5555-5555-5555-555555555555',
            headers: { 'idempotency-key': 'k'.repeat(32) },
            params: { applicationId: '55555555-5555-5555-5555-555555555555' },
            body: { fields: { a: 1 } },
        };
        const context = {
            switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200, status: () => undefined }) }),
            getHandler: () => () => undefined,
        };
        const interceptor = new IdempotencyInterceptor(new FlakyStore());
        try {
            const body = await lastValueFrom(interceptor.intercept(context, { handle: () => of({ saved: true }) }));
            strict_1.default.deepEqual(body, { saved: true });
            await new Promise((r) => setImmediate(r));
            strict_1.default.deepEqual(unhandled, []);
        }
        finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});
//# sourceMappingURL=idempotency.test.js.map