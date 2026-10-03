"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryIdempotencyStore = exports.IdempotencyStore = exports.IDEMPOTENCY_STATE = void 0;
exports.scopeKey = scopeKey;
const common_1 = require("@nestjs/common");
/**
 * Idempotency 레코드 저장소 포트.
 * canonical: k-admission-postgresql-ddl.txt — idempotency_record
 *   state CHECK (state IN ('PROCESSING','COMPLETED','FAILED'))
 *   UNIQUE (application_id, operation, idempotency_key)
 *   application_id uuid NOT NULL REFERENCES application(id)
 *
 * ⚠️ application_id 가 NOT NULL 이라 **원서 생성(POST /applications)은 이 테이블을 쓸 수 없다.**
 * 아직 application 이 없기 때문이다. 불일치 대장 D-12 참조.
 * 생성의 중복은 application 의 자연키
 * UNIQUE (cycle_id, applicant_id, admission_type_id, department_id) 가 막는다.
 */
exports.IDEMPOTENCY_STATE = ['PROCESSING', 'COMPLETED', 'FAILED'];
class IdempotencyStore {
}
exports.IdempotencyStore = IdempotencyStore;
function scopeKey(scope) {
    return `${scope.applicationId}::${scope.operation}::${scope.key}`;
}
/**
 * 메모리 어댑터 — 단위 테스트용.
 * 프로세스가 여러 개면 동작하지 않는다. 운영에서는 절대 사용하지 않는다.
 */
let InMemoryIdempotencyStore = class InMemoryIdempotencyStore extends IdempotencyStore {
    records = new Map();
    async acquire(scope, requestHash) {
        const k = scopeKey(scope);
        const existing = this.records.get(k);
        if (existing)
            return existing;
        this.records.set(k, { scope, requestHash, state: 'PROCESSING' });
        return null;
    }
    async complete(scope, responseStatus, responseBody) {
        const record = this.records.get(scopeKey(scope));
        if (!record)
            return;
        record.state = 'COMPLETED';
        record.responseStatus = responseStatus;
        record.responseBody = responseBody;
    }
    async fail(scope) {
        const record = this.records.get(scopeKey(scope));
        if (!record)
            return;
        record.state = 'FAILED';
    }
    /** 메모리 어댑터는 만료가 없다. */
    async purgeExpired() {
        return 0;
    }
    /** 시험이 채운다. */
    owners = new Map();
    async applicationOf(ref) {
        return this.owners.get(ref.paymentId ?? ref.documentId ?? '') ?? null;
    }
};
exports.InMemoryIdempotencyStore = InMemoryIdempotencyStore;
exports.InMemoryIdempotencyStore = InMemoryIdempotencyStore = __decorate([
    (0, common_1.Injectable)()
], InMemoryIdempotencyStore);
//# sourceMappingURL=idempotency.store.js.map