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
exports.ActivationRecorder = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
const audit_service_1 = require("../audit/audit.service");
const activation_signer_1 = require("./activation-signer");
/**
 * 서명된 활성화 기록 — v1.1 §B17 · §A1 · §A14 (T-M3-14·15)
 *
 * 마감 정책·설정이 **적용되는 사건**마다 한 행을 남긴다.
 * 정책·설정 행은 "무엇" 이고, 이 행은 "언제·누가·왜 그것을 적용했는가" 다.
 *
 * **반드시 활성화와 같은 트랜잭션에서 부른다.** 활성화는 됐는데 기록이 없거나,
 * 기록은 있는데 활성화가 안 된 상태가 생기면 이 기록은 증거가 아니라 소문이 된다.
 *
 * 같은 트랜잭션에서 감사 체인에도 한 줄 남긴다. 서명은 "남은 행이 진짜인가" 를,
 * 감사 체인은 "빠진 사건이 없는가" 를 증명한다. 둘은 다른 질문이다.
 */
let ActivationRecorder = class ActivationRecorder {
    db;
    signer;
    audit;
    constructor(db, signer, audit) {
        this.db = db;
        this.signer = signer;
        this.audit = audit;
    }
    async record(client, input) {
        const activationId = (0, node_crypto_1.randomUUID)();
        const payload = {
            schema: 'k-admission.activation.v1',
            activationId,
            universityId: config_1.UNIVERSITY_ID,
            cycleId: input.cycleId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            subjectVersion: input.subjectVersion,
            kind: input.kind,
            effectiveAt: input.effectiveAt.toISOString(),
            operatorId: input.operatorId,
            reason: input.reason ?? null,
            decisionRef: input.decisionRef ?? null,
            supersedesVersion: input.supersedesVersion ?? null,
            content: input.content,
        };
        const signed = this.signer.sign(payload);
        const { rows } = await client.query(`INSERT INTO activation_record
         (id, cycle_id, subject_type, subject_id, subject_version, kind, effective_at,
          operator_id, reason, decision_ref, supersedes_version,
          payload, payload_hash, signature, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING recorded_at`, [
            activationId,
            input.cycleId,
            input.subjectType,
            input.subjectId,
            input.subjectVersion,
            input.kind,
            input.effectiveAt,
            input.operatorId,
            input.reason ?? null,
            input.decisionRef ?? null,
            input.supersedesVersion ?? null,
            JSON.stringify(payload),
            signed.payloadHash,
            signed.signature,
            signed.keyId,
        ]);
        await this.audit.record(client, {
            actorType: 'ADMIN',
            actorId: input.operatorId,
            action: 'ADMIN_CHANGED_CONFIG',
            result: 'ACCEPTED',
            ...(input.subjectType === 'DEADLINE_POLICY'
                ? { policyVersion: input.subjectVersion }
                : { configVersion: input.subjectVersion }),
            // 사유 원문은 서명된 기록에 있다. 감사에는 그 기록을 가리키는 해시만 둔다.
            details: {
                activationId,
                subjectType: input.subjectType,
                kind: input.kind,
                supersedesVersion: input.supersedesVersion ?? null,
                decisionRef: input.decisionRef ?? null,
                payloadHash: signed.payloadHash,
                keyId: signed.keyId,
            },
        });
        return {
            activationId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            subjectVersion: input.subjectVersion,
            kind: input.kind,
            effectiveAt: payload.effectiveAt,
            operatorId: input.operatorId,
            reason: payload.reason,
            decisionRef: payload.decisionRef,
            supersedesVersion: payload.supersedesVersion,
            content: input.content,
            keyId: signed.keyId,
            payloadHash: signed.payloadHash,
            recordedAt: (rows[0]?.recorded_at ?? new Date()).toISOString(),
            signature: 'VALID',
        };
    }
    /** 한 전형의 활성화 이력. 서명은 조회할 때마다 다시 검증한다. */
    async list(cycleId, filter = {}) {
        const { rows } = await this.db.query(`SELECT id, subject_type, subject_id, subject_version, kind, effective_at, operator_id,
              reason, decision_ref, supersedes_version, payload, payload_hash, signature,
              key_id, recorded_at
         FROM activation_record
        WHERE cycle_id = $1
          AND ($2::text IS NULL OR subject_type = $2)
          AND ($3::uuid IS NULL OR subject_id = $3)
        ORDER BY recorded_at, id`, [cycleId, filter.subjectType ?? null, filter.subjectId ?? null]);
        return rows.map((r) => this.toView(r));
    }
    /**
     * 운영자 행위 감사 체인 검증. 서명은 남은 기록이 진짜인지를, 체인은 빠진 기록이
     * 없는지를 말한다. 활성화 기록을 누가 트리거를 끄고 지웠다면 여기서 드러난다.
     */
    async verifySystemChain() {
        return this.db.tx((client) => this.audit.verifySystemChain(client));
    }
    toView(r) {
        const payload = r.payload;
        let status = this.signer.verify({
            payload,
            payloadHash: String(r.payload_hash),
            signature: String(r.signature),
            keyId: String(r.key_id),
        });
        // 서명이 맞아도 컬럼이 서명한 내용과 다르면 거짓 기록이다.
        // 트리거가 UPDATE 를 막지만, 트리거를 끄고 고친 경우까지 잡는다.
        if (status === 'VALID' && !columnsMatchPayload(r, payload))
            status = 'INVALID';
        return {
            activationId: String(r.id),
            subjectType: r.subject_type,
            subjectId: String(r.subject_id),
            subjectVersion: String(r.subject_version),
            kind: r.kind,
            effectiveAt: r.effective_at.toISOString(),
            operatorId: String(r.operator_id),
            reason: r.reason === null ? null : String(r.reason),
            decisionRef: r.decision_ref === null ? null : String(r.decision_ref),
            supersedesVersion: r.supersedes_version === null ? null : String(r.supersedes_version),
            content: payload.content ?? {},
            keyId: String(r.key_id),
            payloadHash: String(r.payload_hash),
            recordedAt: r.recorded_at.toISOString(),
            signature: status,
        };
    }
};
exports.ActivationRecorder = ActivationRecorder;
exports.ActivationRecorder = ActivationRecorder = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        activation_signer_1.ActivationSigner,
        audit_service_1.AuditService])
], ActivationRecorder);
function columnsMatchPayload(r, p) {
    return (p.activationId === String(r.id) &&
        p.subjectId === String(r.subject_id) &&
        p.subjectVersion === String(r.subject_version) &&
        p.kind === String(r.kind) &&
        p.effectiveAt === r.effective_at.toISOString() &&
        p.operatorId === String(r.operator_id) &&
        (p.reason ?? null) === (r.reason ?? null) &&
        (p.decisionRef ?? null) === (r.decision_ref ?? null));
}
//# sourceMappingURL=activation-recorder.js.map