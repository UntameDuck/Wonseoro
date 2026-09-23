import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { CancellationService } from './cancellation.service';

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

let db: Db;
let available = false;
let applicantId: string;

const service = () => new CancellationService(db, new AuditService());

async function seed(status: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, CYCLE, applicantId, TYPE, DEPT, status],
  );
  return id;
}

async function seedConfirmedPayment(appId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,'CONFIRMED',now())`,
    [id, appId, `TX-${id.slice(0, 12)}`],
  );
  return id;
}

async function statusOf(appId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM application WHERE id = $1`,
    [appId],
  );
  return rows[0]?.status ?? '';
}

async function cleanup(appId: string): Promise<void> {
  await db.query(`DELETE FROM reconciliation_exception WHERE application_id = $1`, [appId]);
  await db.query(`DELETE FROM audit_event WHERE application_id = $1`, [appId]);
  await db.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [appId]);
  await db.query(`DELETE FROM submission WHERE application_id = $1`, [appId]);
  await db.query(
    `DELETE FROM payment_event WHERE payment_id IN
       (SELECT id FROM payment WHERE application_id = $1)`,
    [appId],
  );
  await db.query(`DELETE FROM payment WHERE application_id = $1`, [appId]);
  await db.query(`DELETE FROM application WHERE id = $1`, [appId]);
}

async function statusOfProblem(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { problem?: { status: number } }).problem?.status;
  }
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  applicantId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, decode('00','hex'), 'v1')`,
    [applicantId, `subj-cancel-${applicantId.slice(0, 8)}`],
  );
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
  await db.onApplicationShutdown();
});

describe('취소 가능 상태 (불일치 대장 D-7)', () => {
  for (const status of ['DRAFT', 'READY', 'PAYMENT_PENDING', 'PAID']) {
    it(`${status} 에서는 취소할 수 있다`, async (t) => {
      if (!available) return t.skip('DATABASE_URL 없음');
      const appId = await seed(status);
      try {
        const result = await service().cancel({
          applicationId: appId,
          applicantId,
          reason: '다른 대학에 지원하기로 했습니다.',
        });
        assert.equal(result.status, 'CANCELLED');
        assert.equal(await statusOf(appId), 'CANCELLED');
      } finally {
        await cleanup(appId);
      }
    });
  }
});

describe('취소할 수 없는 상태', () => {
  it('FINALIZED 는 취소하지 않는다 — 원장을 덮으면 안 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('FINALIZED');
    try {
      assert.equal(
        await statusOfProblem(
          service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' }),
        ),
        409,
      );
      // 거부했으면 상태도 그대로여야 한다.
      assert.equal(await statusOf(appId), 'FINALIZED');
    } finally {
      await cleanup(appId);
    }
  });

  it('FINALIZING 중에는 취소하지 않는다 — 취소와 커밋이 경합한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('FINALIZING');
    try {
      assert.equal(
        await statusOfProblem(
          service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' }),
        ),
        409,
      );
      assert.equal(await statusOf(appId), 'FINALIZING');
    } finally {
      await cleanup(appId);
    }
  });

  it('이미 취소된 원서는 다시 취소하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('CANCELLED');
    try {
      assert.equal(
        await statusOfProblem(
          service().cancel({ applicationId: appId, applicantId, reason: '취소하고 싶습니다' }),
        ),
        400,
      );
    } finally {
      await cleanup(appId);
    }
  });

  it('사유 없이는 취소할 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('DRAFT');
    try {
      // 사유가 없으면 나중에 분쟁이 됐을 때 아무것도 설명하지 못한다.
      assert.equal(
        await statusOfProblem(
          service().cancel({ applicationId: appId, applicantId, reason: '   ' }),
        ),
        400,
      );
      assert.equal(await statusOf(appId), 'DRAFT');
    } finally {
      await cleanup(appId);
    }
  });
});

describe('환불 연계', () => {
  it('확정 결제가 있으면 환불 대기로 큐에 올린다 — 자동 환불하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('PAID');
    const paymentId = await seedConfirmedPayment(appId);

    try {
      const result = await service().cancel({
        applicationId: appId,
        applicantId,
        reason: '착오로 지원했습니다.',
      });
      assert.equal(result.refundRequired, true);
      assert.equal(result.paymentId, paymentId);

      const { rows } = await db.query<{ severity: string; facts: { amount: number } }>(
        `SELECT severity, facts FROM reconciliation_exception
          WHERE application_id = $1 AND exception_type = 'REFUND_REQUIRED_AFTER_CANCEL'`,
        [appId],
      );
      assert.equal(rows.length, 1, '환불 의무가 큐에 보이지 않으면 아무도 처리하지 않는다');
      assert.equal(rows[0]?.severity, 'HIGH');
      assert.equal(Number(rows[0]?.facts.amount), 55000);

      // 결제는 아직 CONFIRMED 다. 실제 환불 전에 REFUNDED 로 적으면 장부가 거짓이 된다.
      const paid = await db.query<{ status: string }>(
        `SELECT status FROM payment WHERE id = $1`,
        [paymentId],
      );
      assert.equal(paid.rows[0]?.status, 'CONFIRMED');
    } finally {
      await cleanup(appId);
    }
  });

  it('결제가 없으면 환불 대기를 만들지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('READY');
    try {
      const result = await service().cancel({
        applicationId: appId,
        applicantId,
        reason: '지원을 그만둡니다.',
      });
      assert.equal(result.refundRequired, false);

      const { rowCount } = await db.query(
        `SELECT 1 FROM reconciliation_exception WHERE application_id = $1`,
        [appId],
      );
      // 정상 건이 큐에 섞이면 실제 사고가 묻힌다. (§B18)
      assert.equal(rowCount, 0);
    } finally {
      await cleanup(appId);
    }
  });
});

describe('취소의 흔적', () => {
  it('감사와 Outbox 를 같은 트랜잭션에 남긴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('READY');
    try {
      await service().cancel({
        applicationId: appId,
        applicantId,
        reason: '진로를 변경했습니다.',
      });

      const audit = await db.query<{ action: string; details_redacted: { reason?: string } }>(
        `SELECT action, details_redacted FROM audit_event
          WHERE application_id = $1 AND action = 'APPLICATION_CANCELLED'`,
        [appId],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(audit.rows[0]?.details_redacted?.reason, '진로를 변경했습니다.');

      const outbox = await db.query<{ event_type: string; payload: { status: string } }>(
        `SELECT event_type, payload FROM outbox_event WHERE aggregate_id = $1`,
        [appId],
      );
      assert.equal(outbox.rowCount, 1);
      assert.equal(outbox.rows[0]?.event_type, 'kr.kadmission.application.cancelled.v1');
      assert.equal(outbox.rows[0]?.payload.status, 'CANCELLED');
    } finally {
      await cleanup(appId);
    }
  });

  it('중앙으로 나가는 이벤트에 취소 사유를 넣지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seed('READY');
    const secret = '가정형편이 어려워졌습니다.';
    try {
      await service().cancel({ applicationId: appId, applicantId, reason: secret });

      const { rows } = await db.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_event WHERE aggregate_id = $1`,
        [appId],
      );
      // 사유는 개인 사정이다. 중앙이 알아야 할 이유가 없다. (v1.1 §A3)
      assert.ok(!JSON.stringify(rows[0]?.payload).includes(secret));
    } finally {
      await cleanup(appId);
    }
  });
});
