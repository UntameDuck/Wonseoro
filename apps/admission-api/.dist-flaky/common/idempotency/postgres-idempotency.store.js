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
exports.PostgresIdempotencyStore = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const server_kit_1 = require("@wonseoro/server-kit");
const idempotency_store_1 = require("./idempotency.store");
/** 레코드 보존 기간. DDL 의 expires_at 에 넣는다. */
const TTL_HOURS = 24;
/**
 * Postgres 어댑터.
 *
 * 선점은 `INSERT ... ON CONFLICT DO NOTHING` 한 방으로 한다.
 * SELECT 후 INSERT 하면 마감 피크의 동시 요청에서 둘 다 통과한다.
 * INSERT 가 0건이면 다른 요청이 먼저 잡은 것이므로 그때 읽는다.
 *
 * Finalize 에서는 `acquireForUpdate` 로 행을 잠근 뒤 트랜잭션을 진행한다.
 * (v1.1 §02 Finalize 1단계 — Idempotency record 확인/잠금)
 */
let PostgresIdempotencyStore = class PostgresIdempotencyStore extends idempotency_store_1.IdempotencyStore {
    db;
    constructor(db) {
        super();
        this.db = db;
    }
    async acquire(scope, requestHash) {
        // 만료 시각은 DB 시계로 찍는다 — 정리(purgeExpired)도 DB 시계로 비교한다. (§A2)
        const inserted = await this.db.query(`INSERT INTO idempotency_record
         (id, application_id, operation, idempotency_key, request_hash, state, expires_at)
       VALUES ($1,$2,$3,$4,$5,'PROCESSING', now() + make_interval(hours => $6))
       ON CONFLICT (application_id, operation, idempotency_key) DO NOTHING`, [(0, node_crypto_1.randomUUID)(), scope.applicationId, scope.operation, scope.key, requestHash, TTL_HOURS]);
        // 우리가 방금 선점했다.
        if (inserted.rowCount === 1)
            return null;
        const { rows } = await this.db.query(`SELECT request_hash, state, response_status, response_body
         FROM idempotency_record
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3`, [scope.applicationId, scope.operation, scope.key]);
        const row = rows[0];
        if (!row)
            return null; // 만료 정리와 경합. 새 요청으로 취급한다.
        return {
            scope,
            requestHash: row.request_hash,
            state: row.state,
            ...(row.response_status !== null ? { responseStatus: row.response_status } : {}),
            ...(row.response_body !== null ? { responseBody: row.response_body } : {}),
        };
    }
    async complete(scope, responseStatus, responseBody) {
        await this.db.query(`UPDATE idempotency_record
          SET state = 'COMPLETED', response_status = $4, response_body = $5, updated_at = now()
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3
          AND state = 'PROCESSING'`, [
            scope.applicationId,
            scope.operation,
            scope.key,
            responseStatus,
            JSON.stringify(responseBody ?? null),
        ]);
    }
    /**
     * 실패는 삭제가 아니라 FAILED 로 남긴다. (D-11)
     * 같은 키로 재시도하면 실패 기록이 남아 있으므로, 재시도 허용 여부는 호출부가 판단한다.
     */
    async fail(scope) {
        await this.db.query(`UPDATE idempotency_record
          SET state = 'FAILED', updated_at = now()
        WHERE application_id = $1 AND operation = $2 AND idempotency_key = $3
          AND state = 'PROCESSING'`, [scope.applicationId, scope.operation, scope.key]);
    }
    /**
     * 만료 레코드 정리. 예약 작업(IdempotencyPurgeScheduler)이 부른다.
     * 한 번에 batch 건씩 지운다 — 쌓인 것을 한 문장으로 지우면 잠금과 WAL 이 한꺼번에 몰린다.
     */
    async purgeExpired(batch = 5_000) {
        const res = await this.db.query(`DELETE FROM idempotency_record
        WHERE id IN (SELECT id FROM idempotency_record WHERE expires_at < now() LIMIT $1)`, [batch]);
        return res.rowCount ?? 0;
    }
    async applicationOf(ref) {
        if (ref.paymentId && UUID.test(ref.paymentId)) {
            const { rows } = await this.db.query(`SELECT application_id FROM payment WHERE id = $1`, [ref.paymentId]);
            return rows[0]?.application_id ?? null;
        }
        if (ref.documentId && UUID.test(ref.documentId)) {
            const { rows } = await this.db.query(`SELECT application_id FROM document WHERE id = $1`, [ref.documentId]);
            return rows[0]?.application_id ?? null;
        }
        return null;
    }
};
exports.PostgresIdempotencyStore = PostgresIdempotencyStore;
exports.PostgresIdempotencyStore = PostgresIdempotencyStore = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db])
], PostgresIdempotencyStore);
/** 형식이 틀린 식별자로 DB 에 묻지 않는다(uuid 캐스트 오류가 500 이 된다). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//# sourceMappingURL=postgres-idempotency.store.js.map