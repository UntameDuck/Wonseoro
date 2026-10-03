"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const server_kit_1 = require("@wonseoro/server-kit");
const audit_service_1 = require("../audit/audit.service");
const cancellation_service_1 = require("./cancellation.service");
const break_glass_1 = require("../../test-support/break-glass");
/**
 * 원서 취소 통합 테스트 — 실제 PostgreSQL 이 필요하다.
 *
 * 여기서 지키려는 것은 두 가지다.
 *   1. 접수가 성립한 뒤에는 원장을 덮지 않는다
 *   2. 돈이 걸린 취소는 코드가 임의로 처리하지 않고 사람에게 넘긴다
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db;
let available = false;
let applicantId;
const service = () => new cancellation_service_1.CancellationService(db, new audit_service_1.AuditService());
async function seed(status) {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`, [id, CYCLE, applicantId, TYPE, DEPT, status]);
    return id;
}
async function seedConfirmedPayment(appId) {
    const id = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,'CONFIRMED',now())`, [id, appId, `TX-${id.slice(0, 12)}`]);
    return id;
}
async function statusOf(appId) {
    const { rows } = await db.query(`SELECT status FROM application WHERE id = $1`, [appId]);
    return rows[0]?.status ?? '';
}
/**
 * 정리.
 *
 * 먼저 원서 행을 잠근다. 대조(Reconciliation)가 다른 테스트에서 동시에 돌면서
 * 이 원서에 예외를 새로 달 수 있고, 그러면 예외를 지운 뒤 원서를 지우는 사이에
 * 새 예외가 끼어들어 외래키 위반이 난다. 부모 행을 FOR UPDATE 로 잡으면
 * 자식 INSERT 가 가져가는 FK 잠금과 충돌해 그 틈이 닫힌다.
 */
async function cleanup(appId) {
    // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
    await (0, break_glass_1.breakGlass)(async (client) => {
        await client.query(`SELECT id FROM application WHERE id = $1 FOR UPDATE`, [appId]);
        await client.query(`DELETE FROM reconciliation_exception WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM audit_event WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [appId]);
        await client.query(`DELETE FROM submission WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM payment_event WHERE payment_id IN
         (SELECT id FROM payment WHERE application_id = $1)`, [appId]);
        await client.query(`DELETE FROM payment WHERE application_id = $1`, [appId]);
        await client.query(`DELETE FROM application WHERE id = $1`, [appId]);
    });
}
async function statusOfProblem(p) {
    try {
        await p;
        return undefined;
    }
    catch (err) {
        return err.problem?.status;
    }
}
(0, node_test_1.before)(async () => {
    if (!process.env.DATABASE_URL)
        return;
    db = new server_kit_1.Db('admission-api', 'kadmission');
    available = await db.healthy();
    if (!available)
        return;
    applicantId = (0, node_crypto_1.randomUUID)();
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, decode('00','hex'), 'v1')`, [applicantId, `subj-cancel-${applicantId.slice(0, 8)}`]);
});
(0, node_test_1.after)(async () => {
    if (!available)
        return;
    await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    await db.onApplicationShutdown();
});
(0, node_test_1.describe)('취소 가능 상태 (불일치 대장 D-7)', () => {
    for (const status of ['DRAFT', 'READY', 'PAYMENT_PENDING', 'PAID']) {
        (0, node_test_1.it)(`${status} 에서는 취소할 수 있다`, async (t) => {
            if (!available)
                return t.skip('DATABASE_URL 없음');
            const appId = await seed(status);
            try {
                const result = await service().cancel({
                    applicationId: appId,
                    applicantId,
                    reason: '다른 대학에 지원하기로 했습니다.',
                });
                strict_1.default.equal(result.status, 'CANCELLED');
                strict_1.default.equal(await statusOf(appId), 'CANCELLED');
            }
            finally {
                await cleanup(appId);
            }
        });
    }
});
(0, node_test_1.describe)('취소할 수 없는 상태', () => {
    (0, node_test_1.it)('FINALIZED 는 취소하지 않는다 — 원장을 덮으면 안 된다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('FINALIZED');
        try {
            strict_1.default.equal(await statusOfProblem(service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' })), 409);
            // 거부했으면 상태도 그대로여야 한다.
            strict_1.default.equal(await statusOf(appId), 'FINALIZED');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('FINALIZING 중에는 취소하지 않는다 — 취소와 커밋이 경합한다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('FINALIZING');
        try {
            strict_1.default.equal(await statusOfProblem(service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' })), 409);
            strict_1.default.equal(await statusOf(appId), 'FINALIZING');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('이미 취소된 원서는 다시 취소하지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('CANCELLED');
        try {
            strict_1.default.equal(await statusOfProblem(service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' })), 400);
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('사유 없이는 취소할 수 없다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('DRAFT');
        try {
            // 사유가 없으면 나중에 분쟁이 됐을 때 아무것도 설명하지 못한다.
            strict_1.default.equal(await statusOfProblem(service().cancel({ applicationId: appId, applicantId, reason: '   ' })), 400);
            strict_1.default.equal(await statusOf(appId), 'DRAFT');
        }
        finally {
            await cleanup(appId);
        }
    });
});
(0, node_test_1.describe)('환불 연계', () => {
    (0, node_test_1.it)('확정 결제가 있으면 환불 대기로 큐에 올린다 — 자동 환불하지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('PAID');
        const paymentId = await seedConfirmedPayment(appId);
        try {
            const result = await service().cancel({
                applicationId: appId,
                applicantId,
                reason: '착오로 지원했습니다.',
            });
            strict_1.default.equal(result.refundRequired, true);
            strict_1.default.equal(result.paymentId, paymentId);
            const { rows } = await db.query(`SELECT severity, facts FROM reconciliation_exception
          WHERE application_id = $1 AND exception_type = 'REFUND_REQUIRED_AFTER_CANCEL'`, [appId]);
            strict_1.default.equal(rows.length, 1, '환불 의무가 큐에 보이지 않으면 아무도 처리하지 않는다');
            strict_1.default.equal(rows[0]?.severity, 'HIGH');
            strict_1.default.equal(Number(rows[0]?.facts.amount), 55000);
            // 결제는 아직 CONFIRMED 다. 실제 환불 전에 REFUNDED 로 적으면 장부가 거짓이 된다.
            const paid = await db.query(`SELECT status FROM payment WHERE id = $1`, [paymentId]);
            strict_1.default.equal(paid.rows[0]?.status, 'CONFIRMED');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('결제가 없으면 환불 대기를 만들지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('READY');
        try {
            const result = await service().cancel({
                applicationId: appId,
                applicantId,
                reason: '지원을 그만둡니다.',
            });
            strict_1.default.equal(result.refundRequired, false);
            const { rowCount } = await db.query(`SELECT 1 FROM reconciliation_exception WHERE application_id = $1`, [appId]);
            // 정상 건이 큐에 섞이면 실제 사고가 묻힌다. (§B18)
            strict_1.default.equal(rowCount, 0);
        }
        finally {
            await cleanup(appId);
        }
    });
});
(0, node_test_1.describe)('취소의 흔적', () => {
    (0, node_test_1.it)('감사와 Outbox 를 같은 트랜잭션에 남긴다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('READY');
        try {
            await service().cancel({
                applicationId: appId,
                applicantId,
                reason: '진로를 변경했습니다.',
            });
            const audit = await db.query(`SELECT action, details_redacted FROM audit_event
          WHERE application_id = $1 AND action = 'APPLICATION_CANCELLED'`, [appId]);
            strict_1.default.equal(audit.rowCount, 1);
            strict_1.default.equal(audit.rows[0]?.details_redacted?.reason, '진로를 변경했습니다.');
            const outbox = await db.query(`SELECT event_type, payload FROM outbox_event WHERE aggregate_id = $1`, [appId]);
            strict_1.default.equal(outbox.rowCount, 1);
            strict_1.default.equal(outbox.rows[0]?.event_type, 'kr.kadmission.application.cancelled.v1');
            // CloudEvents 스키마 ApplicationCancelledData 그대로 — 필드가 빠지면 중앙이 거절한다 (D-50)
            strict_1.default.deepEqual(Object.keys(outbox.rows[0].payload).sort(), ['applicationId', 'cancelledAt', 'integrityHash', 'reasonCode']);
            strict_1.default.equal(outbox.rows[0]?.payload.reasonCode, 'APPLICANT_REQUEST');
            strict_1.default.notEqual(outbox.rows[0]?.payload.applicationId, appId, '대학 내부 UUID 를 보내지 않는다');
        }
        finally {
            await cleanup(appId);
        }
    });
    (0, node_test_1.it)('중앙으로 나가는 이벤트에 취소 사유를 넣지 않는다', async (t) => {
        if (!available)
            return t.skip('DATABASE_URL 없음');
        const appId = await seed('READY');
        const secret = '가정형편이 어려워졌습니다.';
        try {
            await service().cancel({ applicationId: appId, applicantId, reason: secret });
            const { rows } = await db.query(`SELECT payload FROM outbox_event WHERE aggregate_id = $1`, [appId]);
            // 사유는 개인 사정이다. 중앙이 알아야 할 이유가 없다. (v1.1 §A3)
            strict_1.default.ok(!JSON.stringify(rows[0]?.payload).includes(secret));
        }
        finally {
            await cleanup(appId);
        }
    });
});
//# sourceMappingURL=cancellation.integration.test.js.map