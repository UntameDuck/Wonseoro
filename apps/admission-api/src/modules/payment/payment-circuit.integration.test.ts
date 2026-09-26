import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PaymentStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { BREAKER } from '../../config';
import { AuditService } from '../audit/audit.service';
import { IntentResult, PaymentProviderPort, VerifyResult } from './payment.provider';
import { PaymentService } from './payment.service';

/**
 * PG Circuit Breaker 통합 테스트 — 실제 PostgreSQL 이 필요하다. (v1.1 §01 C8·§B4)
 *
 * 확인할 것은 하나다. **PG 가 끊겨도 확인 못 한 결제가 CONFIRMED 가 되지 않는다.**
 * 그리고 끊긴 뒤에는 PG 에 묻지 않아 대기가 쌓이지 않는다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
let applicantId: string;

/** PG 에 닿지 않는 상황. 몇 번 불렸는지 센다 — 열린 뒤에는 불리면 안 된다. */
class UnreachablePg extends PaymentProviderPort {
  readonly name = 'mock-pg';
  calls = 0;
  down = true;

  async createIntent(): Promise<IntentResult> {
    this.calls += 1;
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }

  async verify(): Promise<VerifyResult> {
    this.calls += 1;
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    return { status: 'CONFIRMED', providerApprovedAt: new Date().toISOString() };
  }

  async cancel(): Promise<{ status: PaymentStatus }> {
    return { status: 'CANCELLED' };
  }

  async reconcile(): Promise<Array<{ providerTxId: string; status: PaymentStatus }>> {
    return [];
  }
}

async function seedApplication(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'PAYMENT_PENDING')`,
    [id, CYCLE, applicantId, TYPE, DEPT],
  );
  return id;
}

async function seedPayment(appId: string, status: PaymentStatus): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
     VALUES ($1,$2,'mock-pg',$3,55000,$4)`,
    [id, appId, `TX-${randomUUID().slice(0, 12)}`, status],
  );
  return id;
}

async function statusOf(paymentId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM payment WHERE id = $1`, [
    paymentId,
  ]);
  return rows[0]!.status;
}

async function cleanup(appId: string): Promise<void> {
  await db.tx(async (client) => {
    await client.query(`DELETE FROM audit_event WHERE application_id = $1`, [appId]);
    await client.query(
      `DELETE FROM payment_event WHERE payment_id IN
         (SELECT id FROM payment WHERE application_id = $1)`,
      [appId],
    );
    await client.query(`DELETE FROM payment WHERE application_id = $1`, [appId]);
    await client.query(`DELETE FROM application WHERE id = $1`, [appId]);
  });
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  applicantId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-pgcb-${applicantId.slice(0, 8)}`],
  );
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
  await db.onApplicationShutdown();
});

describe('PG Circuit Breaker (v1.1 §01 C8·§B4)', () => {
  it('PG 에 닿지 않으면 UNKNOWN 으로 두고, 이유를 증적에 남긴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    try {
      const paymentId = await seedPayment(appId, 'PENDING');
      const service = new PaymentService(db, new UnreachablePg(), new AuditService(), new DependencyBreakers());

      const result = await service.verify(paymentId);
      assert.equal(result.status, 'UNKNOWN', 'FAILED 로 떨어뜨리면 재결제를 유도한다');
      assert.equal(await statusOf(paymentId), 'UNKNOWN');

      const { rows } = await db.query<{ payload_redacted: { unverifiedCause?: string } }>(
        `SELECT payload_redacted FROM payment_event WHERE payment_id = $1`,
        [paymentId],
      );
      assert.equal(rows[0]?.payload_redacted.unverifiedCause, 'ECONNREFUSED');
    } finally {
      await cleanup(appId);
    }
  });

  it('회로가 열리면 PG 에 묻지 않고, 그래도 CONFIRMED 로 넘기지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    try {
      const pg = new UnreachablePg();
      const breakers = new DependencyBreakers();
      const service = new PaymentService(db, pg, new AuditService(), breakers);

      // 연속 실패로 회로를 연다.
      const tripping = await seedPayment(appId, 'PENDING');
      for (let i = 0; i < BREAKER.failureThreshold; i += 1) await service.verify(tripping);
      assert.equal(breakers.paymentGateway.state, 'OPEN');
      assert.equal(pg.calls, BREAKER.failureThreshold);

      const fresh = await seedPayment(appId, 'CREATED');
      const result = await service.verify(fresh);
      assert.equal(pg.calls, BREAKER.failureThreshold, '열린 회로는 PG 에 닿지 않아야 한다');
      assert.equal(result.status, 'UNKNOWN');

      const { rows } = await db.query<{ payload_redacted: { unverifiedCause?: string } }>(
        `SELECT payload_redacted FROM payment_event WHERE payment_id = $1`,
        [fresh],
      );
      assert.equal(rows[0]?.payload_redacted.unverifiedCause, 'CIRCUIT_OPEN');
    } finally {
      await cleanup(appId);
    }
  });

  it('이미 결론이 난 결제는 PG 가 끊겨도 건드리지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    try {
      const service = new PaymentService(db, new UnreachablePg(), new AuditService(), new DependencyBreakers());
      // FAILED 를 UNKNOWN 으로 되돌리면 이미 끝난 사실이 다시 불확실해진다.
      const failed = await seedPayment(appId, 'FAILED');
      assert.equal((await service.verify(failed)).status, 'FAILED');
      assert.equal(await statusOf(failed), 'FAILED');

      // 이미 UNKNOWN 이면 같은 사실을 매번 새로 기록하지 않는다.
      const unknown = await seedPayment(appId, 'UNKNOWN');
      await service.verify(unknown);
      const { rows } = await db.query(`SELECT 1 FROM payment_event WHERE payment_id = $1`, [unknown]);
      assert.equal(rows.length, 0);
    } finally {
      await cleanup(appId);
    }
  });

  it('PG 가 살아나면 UNKNOWN 이던 결제도 확정된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    try {
      const pg = new UnreachablePg();
      const service = new PaymentService(db, pg, new AuditService(), new DependencyBreakers());
      const paymentId = await seedPayment(appId, 'PENDING');

      assert.equal((await service.verify(paymentId)).status, 'UNKNOWN');
      pg.down = false;
      assert.equal((await service.verify(paymentId)).status, 'CONFIRMED');
    } finally {
      await cleanup(appId);
    }
  });

  it('결제 의도 생성은 503 으로 거절하고 결제 행을 만들지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    try {
      const service = new PaymentService(db, new UnreachablePg(), new AuditService(), new DependencyBreakers());
      await assert.rejects(
        service.createIntent(appId, applicantId, {}),
        (err: unknown) => err instanceof ProblemException && err.getStatus() === 503,
      );
      const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [appId]);
      assert.equal(rows.length, 0, '결제창이 열리지 않았으므로 남길 결제도 없다');
    } finally {
      await cleanup(appId);
    }
  });
});
