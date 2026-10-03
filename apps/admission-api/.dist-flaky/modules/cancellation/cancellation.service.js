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
var CancellationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("@wonseoro/contracts");
const server_kit_1 = require("@wonseoro/server-kit");
const problem_exception_1 = require("../../common/problem/problem.exception");
const central_events_1 = require("../../common/central/central-events");
const audit_service_1 = require("../audit/audit.service");
/** 취소 사유는 이 길이 이상이어야 한다. 한 글자는 사유가 아니다. */
const MIN_REASON_LENGTH = 2;
const MAX_REASON_LENGTH = 500;
/**
 * 원서 취소 — 불일치 대장 D-7 판정에 따른 구현
 *
 * 설계서는 `CANCELLED` 를 DDL·OpenAPI enum 에만 두고 전이를 정의하지 않았다.
 * 여기서 구현한 규칙은 다음과 같고, **노션 §5.6 확인이 필요하다.**
 *
 * 1. 접수가 성립하기 **전** 에만 취소할 수 있다
 *    DRAFT · READY · PAYMENT_PENDING · PAID
 *
 * 2. `FINALIZED` 는 취소하지 않는다
 *    Submission 은 원장이다. 원장을 고쳐 쓰면 "무엇이 접수되었는가" 에 답할 수 없고,
 *    감사 해시체인과 Evidence Package 가 서 있는 전제가 무너진다.
 *    접수 후 취소가 필요하다면 상태를 덮는 것이 아니라 **취소 사실을 덧붙이는**
 *    별도 레코드여야 한다. 계약에 없으므로 지금은 거부하고 입학처로 안내한다.
 *
 * 3. `FINALIZING` 에서도 취소하지 않는다
 *    Finalize 가 비행 중이다. 취소와 커밋이 경합하면 "취소했는데 접수됨" 이 생긴다.
 *    조건부 UPDATE 와 Outbox 로 막아온 것이 정확히 그 종류의 사고다.
 *
 * 4. **환불은 자동으로 하지 않는다**
 *    확정된 결제가 있으면 운영 큐에 올리고 끝낸다. 금액과 귀책 판단이 따르고
 *    되돌릴 수 없는 일이다. 코드가 임의로 돈을 움직이지 않는다. (§B16)
 */
let CancellationService = CancellationService_1 = class CancellationService {
    db;
    audit;
    logger = new common_1.Logger(CancellationService_1.name);
    constructor(db, audit) {
        this.db = db;
        this.audit = audit;
    }
    async cancel(input) {
        const reason = input.reason?.trim() ?? '';
        if (reason.length < MIN_REASON_LENGTH) {
            // 사유 없는 취소는 나중에 분쟁이 됐을 때 아무것도 설명하지 못한다.
            throw problem_exception_1.ProblemException.validationFailed('취소 사유를 입력해 주십시오.');
        }
        if (reason.length > MAX_REASON_LENGTH) {
            throw problem_exception_1.ProblemException.validationFailed(`취소 사유는 ${MAX_REASON_LENGTH}자를 넘을 수 없습니다.`);
        }
        return this.db.tx(async (client) => {
            const current = await this.load(client, input.applicationId);
            this.assertCancellable(current.status);
            // 조건부 UPDATE. 읽고-검사하고-쓰지 않는다. (§B3)
            // 이 사이에 Finalize 가 끼어들면 0건이 되고, 그게 정답이다.
            const moved = await client.query(`UPDATE application
            SET status = 'CANCELLED', version = version + 1, updated_at = now()
          WHERE id = $1 AND status = $2 AND version = $3`, [input.applicationId, current.status, current.version]);
            if (moved.rowCount === 0) {
                throw problem_exception_1.ProblemException.versionConflict('원서 상태가 처리 중에 변경되었습니다. 최신 상태를 다시 확인해 주십시오.');
            }
            const cancelledAt = new Date().toISOString();
            // 환불 의무가 있으면 운영 큐에 올린다. 여기서 돈을 움직이지 않는다.
            const refundRequired = current.confirmedPaymentId !== null;
            if (refundRequired) {
                await this.openRefundTask(client, {
                    applicationId: input.applicationId,
                    paymentId: current.confirmedPaymentId,
                    amount: current.confirmedAmount,
                    reason,
                });
            }
            await this.audit.record(client, {
                applicationId: input.applicationId,
                actorType: 'APPLICANT',
                actorId: input.applicantId,
                action: 'APPLICATION_CANCELLED',
                result: 'ACCEPTED',
                ...(input.traceId ? { traceId: input.traceId } : {}),
                ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
                details: { from: current.status, to: 'CANCELLED', reason, refundRequired },
            });
            await this.enqueueCancelledEvent(client, {
                applicationId: input.applicationId,
                universityId: current.universityId,
                admissionYear: current.admissionYear,
                cancelledAt,
                refundRequired,
            });
            this.logger.log(`application ${input.applicationId} cancelled from ${current.status} ` +
                `(refundRequired=${refundRequired})`);
            return {
                applicationId: input.applicationId,
                status: 'CANCELLED',
                cancelledAt,
                refundRequired,
                paymentId: current.confirmedPaymentId,
            };
        });
    }
    /** 거부 사유를 상태별로 다르게 말한다. "불가능" 과 "지금은 안 된다" 는 다른 안내다. */
    assertCancellable(status) {
        if (status === 'CANCELLED') {
            throw problem_exception_1.ProblemException.validationFailed('이미 취소된 원서입니다.');
        }
        if (status === 'FINALIZED') {
            throw problem_exception_1.ProblemException.cancellationAfterFinalize();
        }
        if (status === 'FINALIZING') {
            // 재시도하면 될 수도 있다. 영구 불가로 안내하면 사용자가 포기한다.
            throw problem_exception_1.ProblemException.versionConflict('접수를 처리하는 중입니다. 잠시 후 다시 확인해 주십시오.');
        }
        if (!(0, contracts_1.canCancel)(status)) {
            throw problem_exception_1.ProblemException.illegalTransition(status, 'CANCELLED');
        }
    }
    /**
     * 환불 대기 항목을 Exception Queue 에 올린다.
     *
     * 대조(Reconciliation)에도 같은 검사가 있다. 중복처럼 보이지만 둘 다 필요하다 —
     * 여기서 올리는 것은 즉시 보이게 하려는 것이고, 대조는 여기가 실패했을 때의 그물이다.
     * 부분 유니크 인덱스가 중복 등록을 막아준다. (D-25)
     */
    async openRefundTask(client, src) {
        await client.query(`INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,'REFUND_REQUIRED_AFTER_CANCEL','HIGH','OPEN',$3)
       ON CONFLICT (application_id, exception_type)
         WHERE state IN ('OPEN','MANUAL_REVIEW')
       DO NOTHING`, [
            (0, node_crypto_1.randomUUID)(),
            src.applicationId,
            JSON.stringify({
                paymentId: src.paymentId,
                amount: src.amount,
                cancelReason: src.reason,
            }),
        ]);
    }
    async enqueueCancelledEvent(client, src) {
        const { rows } = await client.query(`SELECT COALESCE(MAX(aggregate_sequence), 0) + 1 AS next
         FROM outbox_event WHERE aggregate_id = $1`, [src.applicationId]);
        const sequence = Number(rows[0]?.next ?? 1);
        // 중앙에는 "취소됐다" 는 사실과 사유 분류만 보낸다. 사유 문장은 개인정보일 수 있어 보내지 않는다.
        // 본문은 CloudEvents 스키마에 맞춘다 — 전에는 필수 필드가 빠져 중앙이 전부 거절했다. (D-50)
        const payload = (0, central_events_1.cancelledEventData)({ applicationId: src.applicationId, cancelledAt: src.cancelledAt });
        await client.query(`INSERT INTO outbox_event
         (id, aggregate_type, aggregate_id, aggregate_sequence, event_type,
          schema_version, payload, payload_hash, status)
       VALUES ($1,'APPLICATION',$2,$3,$4,'v1',$5,$6,'PENDING')`, [
            (0, node_crypto_1.randomUUID)(),
            src.applicationId,
            sequence,
            contracts_1.EVENT_TYPE.APPLICATION_CANCELLED,
            JSON.stringify(payload),
            (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(payload)).digest('hex'),
        ]);
    }
    async load(client, applicationId) {
        const { rows } = await client.query(`SELECT a.status, a.version, c.university_id, c.admission_year,
              p.id AS payment_id, p.amount
         FROM application a
         JOIN admission_cycle c ON c.id = a.cycle_id
         LEFT JOIN payment p
                ON p.application_id = a.id AND p.status = 'CONFIRMED'
        WHERE a.id = $1`, [applicationId]);
        const r = rows[0];
        if (!r)
            throw problem_exception_1.ProblemException.validationFailed('존재하지 않는 원서입니다.');
        return {
            status: String(r.status),
            version: String(r.version),
            universityId: String(r.university_id),
            admissionYear: Number(r.admission_year),
            confirmedPaymentId: r.payment_id ? String(r.payment_id) : null,
            confirmedAmount: r.amount ? Number(r.amount) : 0,
        };
    }
};
exports.CancellationService = CancellationService;
exports.CancellationService = CancellationService = CancellationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        audit_service_1.AuditService])
], CancellationService);
//# sourceMappingURL=cancellation.service.js.map