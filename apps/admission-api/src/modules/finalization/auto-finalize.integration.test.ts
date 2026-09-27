import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { PG_CALLBACK_SECRET } from '../../config';
import { breakGlass } from '../../test-support/break-glass';
import { ActivationRecorder } from '../activation/activation-recorder';
import { ActivationSigner } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
import { FormSchemaService } from '../config/form-schema.service';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { DeadlineService } from '../deadline/deadline.service';
import { PaymentCallbackController } from '../payment/payment-callback.controller';
import { MockPaymentProvider } from '../payment/payment.provider';
import { PaymentService } from '../payment/payment.service';
import { FinalizationService } from './finalization.service';

/**
 * 결제 = 접수 (D-42) — 실제 PostgreSQL 이 필요하다.
 *
 * 현행 원서접수는 전형료 결제를 마치면 접수가 끝난다. 결제 후 창을 닫은 지원자의 원서가
 * PAID 로 마감을 넘기면 "돈은 냈는데 접수는 안 된" 분쟁이 된다.
 *
 * 개발 시드의 2027 수시 · EARLY 전형을 쓴다 (활성 마감 정책 · 추가문항 3개, 필수 서류 없음).
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const COMPLETE = { highSchool: '원서고등학교', graduationYear: 2026, selfIntro: '열 글자를 넘는 자기소개입니다.' };

let db: Db;
let available = false;
const apps: string[] = [];
const applicants: string[] = [];

/** 서비스 묶음. 모듈이 기동할 때처럼 onModuleInit 으로 결제 훅을 건다. */
function wire() {
  const audit = new AuditService();
  const payments = new PaymentService(db, new MockPaymentProvider(), audit, new DependencyBreakers());
  const recorder = new ActivationRecorder(db, new ActivationSigner(), audit);
  const finalization = new FinalizationService(
    db,
    payments,
    new DeadlineService(new DeadlinePolicyRepository(db, recorder)),
    new FormSchemaService(db),
    audit,
  );
  finalization.onModuleInit();
  return { payments, finalization };
}

async function seedApplication(opts: { fields?: Record<string, unknown>; status?: string } = {}) {
  const id = randomUUID();
  const applicantId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-auto-${applicantId.slice(0, 8)}`],
  );
  applicants.push(applicantId);
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, CYCLE, applicantId, TYPE, DEPT, opts.status ?? 'DRAFT'],
  );
  apps.push(id);
  for (const [code, value] of Object.entries(opts.fields ?? COMPLETE)) {
    await db.query(
      `INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json)
       VALUES ($1,$2,$3,'test',$4)`,
      [randomUUID(), id, code, JSON.stringify(value)],
    );
  }
  return { id, applicantId };
}

async function seedPendingPayment(appId: string): Promise<{ id: string; txId: string }> {
  const id = randomUUID();
  const txId = `MOCK-AF${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
     VALUES ($1,$2,'mock-pg',$3,55000,'PENDING')`,
    [id, appId, txId],
  );
  return { id, txId };
}

async function submissionOf(appId: string) {
  const { rows } = await db.query<{ requested_at: Date; application_number: string }>(
    `SELECT requested_at, application_number FROM submission WHERE application_id = $1`,
    [appId],
  );
  return rows;
}

async function statusOf(appId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM application WHERE id = $1`, [appId]);
  return rows[0]!.status;
}

async function audits(appId: string, action: string) {
  const { rows } = await db.query<{ actor_type: string; actor_id: string; result: string; details_redacted: Record<string, unknown> }>(
    `SELECT actor_type, actor_id, result, details_redacted FROM audit_event
      WHERE application_id = $1 AND action = $2 ORDER BY occurred_at`,
    [appId, action],
  );
  return rows;
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
  await breakGlass(async (c) => {
    await c.query(`SELECT id FROM application WHERE id = ANY($1) FOR UPDATE`, [apps]);
    await c.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM outbox_event WHERE aggregate_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM submission WHERE application_id = ANY($1)`, [apps]);
    await c.query(
      `DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`,
      [apps],
    );
    await c.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM application_field_value WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM application WHERE id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('결제 = 접수 (D-42)', () => {
  it('결제가 확인되면 서버가 접수한다 — 지원자가 창을 닫아도', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id: appId, applicantId } = await seedApplication();

    const { payment } = await payments.createIntent(appId, applicantId, {});
    await payments.verify(payment.id);

    const subs = await submissionOf(appId);
    assert.equal(subs.length, 1);
    assert.equal(await statusOf(appId), 'FINALIZED');

    // 제출 의사를 밝힌 시각은 "결제하기" 로 결제 의도를 만든 시각이다.
    const { rows } = await db.query<{ created_at: Date }>(`SELECT created_at FROM payment WHERE id = $1`, [payment.id]);
    assert.equal(subs[0]!.requested_at.getTime(), rows[0]!.created_at.getTime());

    const [finalized] = await audits(appId, 'APPLICATION_FINALIZED');
    assert.equal(finalized!.actor_type, 'SYSTEM');
    assert.equal(finalized!.details_redacted.trigger, 'PAYMENT_CONFIRMED');
  });

  it('접수할 수 없는 원서는 결제창을 열지 않는다 — 돈을 받은 뒤에 알리면 환불 사건이 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { selfIntro: _missing, ...partial } = COMPLETE;
    const { id: appId, applicantId } = await seedApplication({ fields: partial });

    await assert.rejects(
      payments.createIntent(appId, applicantId, {}),
      (err: unknown) => err instanceof ProblemException && err.getStatus() === 422,
    );
    const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [appId]);
    assert.equal(rows.length, 0, '결제 기록이 생기지 않는다');
  });

  it('PG 콜백으로 확인돼도 접수된다 — 화면이 verify 를 부르지 않은 경우', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id: appId } = await seedApplication();
    const { txId } = await seedPendingPayment(appId);

    const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${randomUUID()}` });
    const signature = createHmac('sha256', PG_CALLBACK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
    const controller = new PaymentCallbackController(payments, new MockPaymentProvider());
    await controller.receive('mock-pg', {
      headers: { 'x-pg-signature': signature },
      rawBody: Buffer.from(body, 'utf8'),
      ip: '127.0.0.1',
    } as never);

    assert.equal((await submissionOf(appId)).length, 1);
  });

  it('결제가 늦게 확인되는 사이 취소한 원서는 접수하지 않는다 — 그 결제는 환불 대상이다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id: appId } = await seedApplication({ status: 'CANCELLED' });
    const { id: paymentId } = await seedPendingPayment(appId);

    const verified = await payments.verify(paymentId);
    assert.equal(verified.status, 'CONFIRMED', '결제 확인 자체는 되돌리지 않는다');
    assert.equal((await submissionOf(appId)).length, 0);
    assert.equal(await statusOf(appId), 'CANCELLED');

    const [rejected] = await audits(appId, 'FINALIZE_REQUESTED');
    assert.equal(rejected!.result, 'REJECTED');
    assert.equal(rejected!.details_redacted.code, 'ILLEGAL_TRANSITION');
  });

  it('자동 접수와 화면 제출이 겹쳐도 접수는 한 건이고, 둘 다 성공으로 답한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments, finalization } = wire();
    const { id: appId, applicantId } = await seedApplication();
    const { id: paymentId } = await seedPendingPayment(appId);

    const [, byApplicant] = await Promise.all([
      payments.verify(paymentId),
      // 결제 확인과 경합하도록 조금 늦게 제출한다. 결제가 아직이면 409 가 정상이다.
      new Promise((r) => setTimeout(r, 5)).then(() =>
        finalization
          .finalize({ applicationId: appId, applicantId, requestedAt: new Date() })
          .catch((err: unknown) => err),
      ),
    ]);

    assert.equal((await submissionOf(appId)).length, 1);
    if (byApplicant instanceof ProblemException) {
      assert.equal(byApplicant.problem.code, 'PAYMENT_NOT_CONFIRMED', `예상 밖 오류: ${byApplicant.problem.code}`);
    } else {
      assert.ok(byApplicant && typeof byApplicant === 'object' && 'submission' in byApplicant);
    }
    // 한 번 더 제출해도 같은 접수를 돌려준다.
    const again = await finalization.finalize({ applicationId: appId, applicantId, requestedAt: new Date() });
    assert.equal(again.created, false);
  });
});
