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
var EvidenceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const activation_recorder_1 = require("../activation/activation-recorder");
const audit_service_1 = require("../audit/audit.service");
/**
 * Evidence Package — 기술설계서 v1.1 §A11·§C6, §09 Repudiation (T-M3-07)
 *
 * **"특정 Application 의 접수과정을 Evidence Package 로 재구성 가능"** 이
 * §01 E 의 핵심 인수기준이다.
 *
 * 2026년 장애에서 구제 판정의 근거가 된 것이 바로 이 기록이다 —
 * 작성·저장·제출·결제 시도 이력. 당시에는 사업자가 로그를 뒤져 사후에 맞췄다.
 * 여기서는 처음부터 **재구성 가능한 형태로** 남긴다.
 *
 * 담기는 것
 *   - 원서 상태와 접수 확정 기록 (접수번호·시각·적용된 정책·설정 버전)
 *   - 그 시점에 **실제로 적용된** 마감정책 스냅샷과 승인자
 *   - 결제 증적 (원문 없이 해시와 상태 전이만)
 *   - 서류 검사 결과
 *   - 동의 기록
 *   - 감사 Timeline + **hash-chain 검증 결과**
 *   - 서버 clock offset (§A9 — 시각 분쟁 대응)
 *
 * 담기지 않는 것
 *   이름·주민등록번호·연락처·주소·원서 본문·첨부파일 원본
 *   이것들 없이도 "언제 무엇을 했는가"는 증명된다.
 *
 * ⚠️ 조회 자체가 감사 대상이다. (§8.3 "민감정보 조회는 목적·사유 입력 및 별도 Audit")
 */
let EvidenceService = EvidenceService_1 = class EvidenceService {
    db;
    audit;
    activations;
    logger = new common_1.Logger(EvidenceService_1.name);
    constructor(db, audit, activations) {
        this.db = db;
        this.audit = audit;
        this.activations = activations;
    }
    /**
     * @param reason 조회 사유. 비워둘 수 없다 — 누가 왜 봤는지가 남아야 한다.
     */
    async generate(applicationId, viewer, reason) {
        if (!reason.trim()) {
            throw problem_exception_1.ProblemException.validationFailed('조회 사유를 입력해야 합니다. 증적 열람은 기록으로 남습니다.');
        }
        const application = await this.loadApplication(applicationId);
        const submission = await this.loadSubmission(applicationId);
        const [deadlinePolicy, configVersion, payments, documents, consents, timeline] = await Promise.all([
            submission ? this.loadPolicy(application.cycleId, submission.deadlinePolicyVersion) : null,
            submission ? this.loadConfig(application.cycleId, submission.configVersion) : null,
            this.loadPayments(applicationId),
            this.loadDocuments(applicationId),
            this.loadConsents(applicationId),
            this.loadTimeline(applicationId),
        ]);
        // hash-chain 검증. 이것이 깨지면 나머지 기록도 신뢰할 수 없다.
        const chainVerification = await this.db.tx((client) => this.audit.verifyChain(client, applicationId));
        const pkg = {
            applicationId,
            generatedAt: new Date().toISOString(),
            application,
            submission,
            deadlinePolicy,
            configVersion,
            payments,
            documents,
            consents,
            timeline,
            chainVerification,
        };
        // 패키지 전체의 무결성 값.
        // generatedAt 은 뺀다 — 같은 내용이면 언제 뽑아도 같은 해시가 나와야
        // 두 번 뽑은 증적이 같은 것임을 보일 수 있다.
        const { generatedAt: _generatedAt, ...stable } = pkg;
        const evidenceHash = (0, node_crypto_1.createHash)('sha256')
            .update(JSON.stringify(stable))
            .digest('hex');
        await this.recordAccess(applicationId, viewer, reason, evidenceHash);
        if (!chainVerification.valid) {
            // 증적이 변조된 상태다. 조용히 넘기지 않는다.
            this.logger.error(`EVIDENCE CHAIN BROKEN application=${applicationId} at=${chainVerification.brokenAt}`);
        }
        return { ...pkg, evidenceHash };
    }
    /** 열람 자체를 감사에 남긴다. 누가 왜 봤는지가 사후에 확인되어야 한다. */
    async recordAccess(applicationId, viewer, reason, evidenceHash) {
        await this.db.tx(async (client) => {
            await this.audit.record(client, {
                applicationId,
                actorType: 'ADMIN',
                actorId: viewer,
                action: 'ADMIN_VIEWED_PII',
                result: 'ACCEPTED',
                details: { purpose: 'EVIDENCE_PACKAGE', reason, evidenceHash },
            });
        });
    }
    async loadApplication(applicationId) {
        const { rows } = await this.db.query(`SELECT a.status, a.version, a.cycle_id, t.code AS type_code, d.code AS dept_code
         FROM application a
         JOIN admission_type t ON t.id = a.admission_type_id
         JOIN department d ON d.id = a.department_id
        WHERE a.id = $1`, [applicationId]);
        const r = rows[0];
        if (!r)
            throw problem_exception_1.ProblemException.validationFailed('존재하지 않는 원서입니다.');
        return {
            status: String(r.status),
            version: String(r.version),
            cycleId: String(r.cycle_id),
            admissionTypeCode: String(r.type_code),
            departmentCode: String(r.dept_code),
        };
    }
    async loadSubmission(applicationId) {
        const { rows } = await this.db.query(`SELECT application_number, requested_at, payment_verified_at, finalized_at,
              deadline_policy_version, config_version, server_clock_offset_ms, evidence_hash
         FROM submission WHERE application_id = $1`, [applicationId]);
        const r = rows[0];
        if (!r)
            return null;
        return {
            applicationNumber: String(r.application_number),
            requestedAt: r.requested_at.toISOString(),
            paymentVerifiedAt: r.payment_verified_at.toISOString(),
            finalizedAt: r.finalized_at.toISOString(),
            deadlinePolicyVersion: String(r.deadline_policy_version),
            configVersion: String(r.config_version),
            serverClockOffsetMs: Number(r.server_clock_offset_ms),
            evidenceHash: String(r.evidence_hash),
        };
    }
    /** 접수 시점에 **실제로 적용된** 정책. 지금 활성인 정책이 아니다. */
    async loadPolicy(cycleId, version) {
        const { rows } = await this.db.query(`SELECT version, mode, deadline_at, approved_by_1, approved_by_2,
              activated_at, policy_hash
         FROM deadline_policy WHERE cycle_id = $1 AND version = $2`, [cycleId, version]);
        const r = rows[0];
        if (!r)
            return null;
        const deadlineAt = r.deadline_at.toISOString();
        const policyHash = String(r.policy_hash);
        const record = (await this.activations.list(cycleId, { subjectType: 'DEADLINE_POLICY' })).find((a) => a.subjectVersion === version);
        return {
            version: String(r.version),
            mode: String(r.mode),
            deadlineAt,
            approvedBy: [r.approved_by_1, r.approved_by_2].filter((a) => typeof a === 'string' && a.length > 0),
            activatedAt: r.activated_at ? r.activated_at.toISOString() : null,
            policyHash,
            signedActivation: record
                ? {
                    activationId: record.activationId,
                    kind: record.kind,
                    effectiveAt: record.effectiveAt,
                    operatorId: record.operatorId,
                    decisionRef: record.decisionRef,
                    keyId: record.keyId,
                    signature: record.signature,
                    matchesPolicy: record.content.deadlineAt === deadlineAt && record.content.policyHash === policyHash,
                }
                : null,
        };
    }
    async loadConfig(cycleId, version) {
        const { rows } = await this.db.query(`SELECT version, config_hash, activated_at
         FROM config_version WHERE cycle_id = $1 AND version = $2`, [cycleId, version]);
        const r = rows[0];
        if (!r)
            return null;
        return {
            version: String(r.version),
            // 설정 원문은 싣지 않는다. 해시로 동일성만 보인다.
            configHash: String(r.config_hash),
            activatedAt: r.activated_at ? r.activated_at.toISOString() : null,
        };
    }
    async loadPayments(applicationId) {
        const { rows } = await this.db.query(`SELECT id, provider, status, amount, provider_approved_at, verified_at
         FROM payment WHERE application_id = $1 ORDER BY created_at`, [applicationId]);
        const out = [];
        for (const r of rows) {
            const events = await this.db.query(`SELECT event_type, occurred_at, payload_hash
           FROM payment_event WHERE payment_id = $1 ORDER BY received_at`, [String(r.id)]);
            out.push({
                provider: String(r.provider),
                status: String(r.status),
                amount: Number(r.amount),
                providerApprovedAt: r.provider_approved_at
                    ? r.provider_approved_at.toISOString()
                    : null,
                verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
                // PG 응답 원문은 남기지 않는다. 해시로 동일성만 보인다. (v1.1 §04)
                events: events.rows.map((e) => ({
                    eventType: String(e.event_type),
                    occurredAt: e.occurred_at ? e.occurred_at.toISOString() : null,
                    payloadHash: String(e.payload_hash),
                })),
            });
        }
        return out;
    }
    async loadDocuments(applicationId) {
        const { rows } = await this.db.query(`SELECT id, document_type, status, sha256_hex
         FROM document WHERE application_id = $1 ORDER BY created_at`, [applicationId]);
        const out = [];
        for (const r of rows) {
            const scans = await this.db.query(`SELECT scanner, engine_version, result, scanned_at FROM document_scan
          WHERE document_id = $1 ORDER BY created_at`, [String(r.id)]);
            out.push({
                documentType: String(r.document_type),
                status: String(r.status),
                // 파일 원본이 아니라 해시. 같은 파일인지 확인하는 데는 이걸로 충분하다.
                sha256: String(r.sha256_hex),
                scans: scans.rows.map((s) => ({
                    scanner: String(s.scanner),
                    // 어느 엔진 버전으로 검사했는가 — 사후에 "그 시점 서명으로 못 잡은 악성코드" 를 가려낸다
                    engineVersion: s.engine_version ? String(s.engine_version) : null,
                    result: String(s.result),
                    scannedAt: s.scanned_at ? s.scanned_at.toISOString() : null,
                })),
            });
        }
        return out;
    }
    async loadConsents(applicationId) {
        const { rows } = await this.db.query(`SELECT consent_code, policy_version, granted_at
         FROM consent_record WHERE application_id = $1 ORDER BY granted_at`, [applicationId]);
        return rows.map((r) => ({
            consentCode: String(r.consent_code),
            policyVersion: String(r.policy_version),
            grantedAt: r.granted_at.toISOString(),
        }));
    }
    async loadTimeline(applicationId) {
        const { rows } = await this.db.query(`SELECT occurred_at, action, result, actor_type, actor_id, trace_id,
              config_version, policy_version, event_hash, prev_hash
         FROM audit_event
        WHERE application_id = $1
        ORDER BY occurred_at ASC, id ASC`, [applicationId]);
        return rows.map((r) => ({
            at: r.occurred_at.toISOString(),
            action: String(r.action),
            result: String(r.result),
            actorType: String(r.actor_type),
            actorId: r.actor_id ? String(r.actor_id) : null,
            traceId: r.trace_id ? String(r.trace_id) : null,
            configVersion: r.config_version ? String(r.config_version) : null,
            policyVersion: r.policy_version ? String(r.policy_version) : null,
            eventHash: String(r.event_hash),
            prevHash: String(r.prev_hash),
        }));
    }
};
exports.EvidenceService = EvidenceService;
exports.EvidenceService = EvidenceService = EvidenceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        audit_service_1.AuditService,
        activation_recorder_1.ActivationRecorder])
], EvidenceService);
//# sourceMappingURL=evidence.service.js.map