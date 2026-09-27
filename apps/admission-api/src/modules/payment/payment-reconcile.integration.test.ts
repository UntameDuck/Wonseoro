import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { Db } from '@wonseoro/server-kit';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.store';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { PG_CALLBACK_SECRET } from '../../config';
import { AuditService } from '../audit/audit.service';
import { ReconciliationScheduler } from '../reconciliation/reconciliation.scheduler';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentRecheckWorker } from './payment-recheck.worker';
import { MockPaymentProvider } from './payment.provider';
import { PaymentRow, PaymentService } from './payment.service';
import { breakGlass } from '../../test-support/break-glass';

/**
 * 결제 자동 정합화 (D-40) — 실제 PostgreSQL 이 필요하다.
 *
 * 확인할 것
 *   - 서명이 맞지 않는 콜백은 아무것도 바꾸지 않는다
 *   - 같은 콜백은 한 번만 처리되고, 상태는 콜백이 아니라 PG 재조회로 정해진다
 *   - 결제가 확인돼도 원서를 제출하지 않는다
 *   - 재확인 워커는 PENDING·UNKNOWN 만, Backoff 간격이 지난 것만 묻는다
 *   - 여러 Pod 중 하나만 돈다
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
const apps: string[] = [];
const applicants: string[] = [];

function sign(body: string): string {
  return createHmac('sha256', PG_CALLBACK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
}

function callbackRequest(body: string, signature?: string) {
  return {
    headers: signature ? { 'x-pg-signature': signature } : {},
    rawBody: Buffer.from(body, 'utf8'),
    ip: '127.0.0.1',
  } as never;
}

/** 지원자마다 활성 원서는 하나다(자연키). 원서마다 지원자를 새로 만든다. */
async function seedApplication(): Promise<string> {
  const id = randomUUID();
  const applicantId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-recon-${applicantId.slice(0, 8)}`],
  );
  applicants.push(applicantId);
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'PAYMENT_PENDING')`,
    [id, CYCLE, applicantId, TYPE, DEPT],
  );
  apps.push(id);
  return id;
}

async function seedPayment(
  appId: string,
  opts: { status: string; txId?: string; verifiedAgo?: string | null; createdAgo?: string },
): Promise<{ id: string; txId: string }> {
  const id = randomUUID();
  const txId = opts.txId ?? `MOCK-RC${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at, created_at)
     VALUES ($1,$2,'mock-pg',$3,55000,$4,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() - $5::interval END,
             now() - $6::interval)`,
    [id, appId, txId, opts.status, opts.verifiedAgo ?? null, opts.createdAgo ?? '0 seconds'],
  );
  return { id, txId };
}

async function addVerifyEvents(paymentId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await db.query(
      `INSERT INTO payment_event (id, payment_id, event_type, payload_hash, occurred_at)
       VALUES ($1,$2,'VERIFY_PENDING','h',now())`,
      [randomUUID(), paymentId],
    );
  }
}

async function events(paymentId: string): Promise<string[]> {
  const { rows } = await db.query<{ event_type: string }>(
    `SELECT event_type FROM payment_event WHERE payment_id = $1 ORDER BY received_at`,
    [paymentId],
  );
  return rows.map((r) => r.event_type);
}

async function statusOf(paymentId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM payment WHERE id = $1`, [paymentId]);
  return rows[0]!.status;
}

function realService(): PaymentService {
  return new PaymentService(db, new MockPaymentProvider(), new AuditService(), new DependencyBreakers());
}

/** 실제 verify 대신 누구를 물었는지만 적는다. 다른 시험 파일의 결제를 건드리지 않기 위해서다. */
function recordingService(): { service: PaymentService; asked: string[] } {
  const asked: string[] = [];
  const service = {
    async verify(id: string): Promise<PaymentRow> {
      asked.push(id);
      return { id, status: 'PENDING' } as PaymentRow;
    },
  } as unknown as PaymentService;
  return { service, asked };
}

/** 다른 Pod 가 잠금을 쥐고 있는 상황. */
async function holdLock(name: string): Promise<() => Promise<void>> {
  const client = await db.pool.connect();
  const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [name]);
  assert.equal(rows[0]?.ok, true);
  return async () => {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]);
    client.release();
  };
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
  await breakGlass(async (client) => {
    // 동시에 도는 대조 시험이 이 원서들에 예외를 달 수 있다(확인된 결제 · 접수 없음).
    // 원서 행을 먼저 잠가, 예외를 지운 뒤 원서를 지우는 사이에 새 예외가 끼지 못하게 한다.
    await client.query(`SELECT id FROM application WHERE id = ANY($1) FOR UPDATE`, [apps]);
    await client.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
    await client.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
    await client.query(
      `DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`,
      [apps],
    );
    await client.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
    await client.query(`DELETE FROM application WHERE id = ANY($1)`, [apps]);
    await client.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('PG 콜백 (D-40)', () => {
  it('Idempotency-Key 없이 들어와도 인터셉터가 막지 않는다 — PG 는 우리 헤더를 모른다', async () => {
    const store = {
      acquire: () => {
        throw new Error('콜백에 멱등 저장소를 쓰면 안 된다');
      },
    } as unknown as IdempotencyStore;
    const interceptor = new IdempotencyInterceptor(store, new Reflector());
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', headers: {}, url: '/api/v1/payments/callbacks/mock-pg' }) }),
      getHandler: () => PaymentCallbackController.prototype.receive,
    } as unknown as ExecutionContext;
    const out = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of('ok') }));
    assert.equal(out, 'ok');
  });

  it('서명이 맞지 않으면 403 이고 아무것도 기록하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    const { id, txId } = await seedPayment(appId, { status: 'PENDING' });
    const service = realService();
    const controller = new PaymentCallbackController(service, new MockPaymentProvider());
    const body = JSON.stringify({ providerTxId: txId, eventId: 'evt-forged' });

    for (const sig of [undefined, 'deadbeef', sign(body + ' ')]) {
      await assert.rejects(
        controller.receive('mock-pg', callbackRequest(body, sig)),
        (err: unknown) => err instanceof ProblemException && err.getStatus() === 403,
      );
    }
    assert.deepEqual(await events(id), []);
    assert.equal(await statusOf(id), 'PENDING');
  });

  it('다른 결제 대행사 이름으로 오면 거절한다', async () => {
    const controller = new PaymentCallbackController({} as PaymentService, new MockPaymentProvider());
    const body = '{}';
    await assert.rejects(
      controller.receive('other-pg', callbackRequest(body, sign(body))),
      (err: unknown) => err instanceof ProblemException && err.getStatus() === 403,
    );
  });

  it('콜백 본문의 상태를 믿지 않고 PG 에 다시 물어 정한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    // 이 거래는 PG 가 FAIL 로 답한다. 콜백은 "성공" 이라고 주장한다.
    const { id, txId } = await seedPayment(appId, {
      status: 'PENDING',
      txId: `MOCK-FAIL${randomUUID().slice(0, 8)}`,
    });
    const controller = new PaymentCallbackController(realService(), new MockPaymentProvider());
    const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${randomUUID()}`, status: 'CONFIRMED' });

    const res = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
    assert.deepEqual(res, { received: true, outcome: 'VERIFIED' });
    assert.equal(await statusOf(id), 'FAILED', '콜백이 CONFIRMED 라고 해도 PG 답이 FAILED 면 FAILED');
  });

  it('같은 콜백은 한 번만 처리하고, 결제가 확인돼도 원서를 제출하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    const { id, txId } = await seedPayment(appId, { status: 'PENDING' });
    const controller = new PaymentCallbackController(realService(), new MockPaymentProvider());
    const body = JSON.stringify({ providerTxId: txId, eventId: `evt-${randomUUID()}` });

    const first = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
    const again = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
    assert.equal(first.outcome, 'VERIFIED');
    assert.equal(again.outcome, 'DUPLICATE');
    assert.equal(await statusOf(id), 'CONFIRMED');
    assert.deepEqual(await events(id), ['CALLBACK_RECEIVED', 'VERIFY_CONFIRMED'], 'PG 재조회는 한 번');

    const { rows } = await db.query<{ status: string }>(`SELECT status FROM application WHERE id = $1`, [appId]);
    assert.equal(rows[0]!.status, 'PAYMENT_PENDING', '제출은 지원자의 의사 표시다');
    const sub = await db.query(`SELECT 1 FROM submission WHERE application_id = $1`, [appId]);
    assert.equal(sub.rows.length, 0);
  });

  it('우리가 모르는 거래도 200 으로 받는다 — 오류를 주면 PG 가 계속 다시 보낸다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const controller = new PaymentCallbackController(realService(), new MockPaymentProvider());
    const body = JSON.stringify({ providerTxId: 'MOCK-NOT-OURS', eventId: 'evt-x' });
    const res = await controller.receive('mock-pg', callbackRequest(body, sign(body)));
    assert.deepEqual(res, { received: true, outcome: 'UNKNOWN_TX' });
  });
});

describe('결제 재확인 워커 (D-40)', () => {
  it('PENDING·UNKNOWN 만 묻고, CREATED·확정된 결제는 묻지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    // 첫 확인은 만든 지 30초 뒤다. 방금 만든 결제는 지원자 화면이 아직 묻고 있다.
    const aMinute = { createdAgo: '1 minute' };
    const pending = await seedPayment(appId, { status: 'PENDING', ...aMinute });
    const unknown = await seedPayment(appId, { status: 'UNKNOWN', ...aMinute });
    const created = await seedPayment(appId, { status: 'CREATED', ...aMinute });
    const confirmed = await seedPayment(appId, { status: 'CONFIRMED', ...aMinute });
    const failed = await seedPayment(appId, { status: 'FAILED', ...aMinute });
    const fresh = await seedPayment(appId, { status: 'PENDING' });

    const { service, asked } = recordingService();
    const worker = new PaymentRecheckWorker(db, service, new DependencyBreakers());
    const res = await worker.tick({ batchSize: 1000 });
    assert.equal(res.skipped, null);
    assert.ok(asked.includes(pending.id));
    assert.ok(asked.includes(unknown.id));
    for (const p of [created, confirmed, failed]) assert.ok(!asked.includes(p.id));
    assert.ok(!asked.includes(fresh.id), '방금 만든 결제는 30초를 기다린다');
  });

  it('확인할수록 간격이 늘어난다 (30초 × 2^(n−1), 최대 30분)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    // 한 번 물었고 40초 지났다 → 간격 30초 → 차례
    const once = await seedPayment(appId, { status: 'PENDING', verifiedAgo: '40 seconds' });
    await addVerifyEvents(once.id, 1);
    // 세 번 물었고 90초 지났다 → 간격 120초 → 아직
    const thrice = await seedPayment(appId, { status: 'PENDING', verifiedAgo: '90 seconds' });
    await addVerifyEvents(thrice.id, 3);
    // 스무 번 물었고 29분 지났다 → 간격 30분(상한) → 아직
    const many = await seedPayment(appId, { status: 'UNKNOWN', verifiedAgo: '29 minutes' });
    await addVerifyEvents(many.id, 20);
    // 스무 번 물었고 31분 지났다 → 차례
    const manyDue = await seedPayment(appId, { status: 'UNKNOWN', verifiedAgo: '31 minutes' });
    await addVerifyEvents(manyDue.id, 20);

    const { service, asked } = recordingService();
    await new PaymentRecheckWorker(db, service, new DependencyBreakers()).tick({ batchSize: 1000 });
    assert.ok(asked.includes(once.id));
    assert.ok(!asked.includes(thrice.id));
    assert.ok(!asked.includes(many.id));
    assert.ok(asked.includes(manyDue.id));
  });

  it('기한이 지난 결제는 더 묻지 않는다 — 대조가 사람에게 넘긴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    const old = await seedPayment(appId, { status: 'UNKNOWN', createdAgo: '49 hours' });
    const { service, asked } = recordingService();
    await new PaymentRecheckWorker(db, service, new DependencyBreakers()).tick({ batchSize: 1000, maxAgeHours: 48 });
    assert.ok(!asked.includes(old.id));
  });

  it('PG 회로가 열려 있으면 이번 주기를 건너뛴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const breakers = new DependencyBreakers();
    for (let i = 0; i < 100 && breakers.paymentGateway.state !== 'OPEN'; i += 1) {
      await breakers.paymentGateway.run(() => Promise.reject(new Error('down'))).catch(() => undefined);
    }
    assert.equal(breakers.paymentGateway.state, 'OPEN');
    const { service, asked } = recordingService();
    const res = await new PaymentRecheckWorker(db, service, breakers).tick();
    assert.equal(res.skipped, 'CIRCUIT_OPEN');
    assert.equal(asked.length, 0);
  });

  it('다른 Pod 가 돌고 있으면 건너뛴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const release = await holdLock(PaymentRecheckWorker.LOCK);
    try {
      const { service, asked } = recordingService();
      const res = await new PaymentRecheckWorker(db, service, new DependencyBreakers()).tick();
      assert.equal(res.skipped, 'LOCKED');
      assert.equal(asked.length, 0);
    } finally {
      await release();
    }
  });

  it('실제 PG 로: 결제 직후 창을 닫아도 워커가 결제 확인을 끝낸다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication();
    // 지원자 화면이 한 번 물었을 때는 아직 PENDING 이었다 (Mock SLOW).
    const { id } = await seedPayment(appId, {
      status: 'PENDING',
      txId: `MOCK-SLOW${randomUUID().slice(0, 8)}`,
      verifiedAgo: '40 seconds',
    });
    await addVerifyEvents(id, 1);
    const provider = new MockPaymentProvider();
    await provider.verify((await db.query<{ provider_tx_id: string }>(
      `SELECT provider_tx_id FROM payment WHERE id = $1`, [id])).rows[0]!.provider_tx_id);

    // 이 결제만 확인하게 워커의 서비스를 감싼다 — 다른 시험 파일의 결제를 PG 에 묻지 않는다.
    const real = new PaymentService(db, provider, new AuditService(), new DependencyBreakers());
    const scoped = {
      verify: (pid: string) => (pid === id ? real.verify(pid) : Promise.resolve({ id: pid, status: 'PENDING' } as PaymentRow)),
    } as unknown as PaymentService;
    const res = await new PaymentRecheckWorker(db, scoped, new DependencyBreakers()).tick({ batchSize: 1000 });
    assert.ok(res.confirmed >= 1);
    assert.equal(await statusOf(id), 'CONFIRMED');
  });
});

describe('대조 스케줄 (D-40)', () => {
  it('한 Pod 만 대조를 돌린다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    let runs = 0;
    const reconciliation = {
      async reconcile(sinceHours: number) {
        runs += 1;
        assert.equal(sinceHours, 48);
        return { checked: 0, opened: 0, autoResolved: 0, stillOpen: 0 };
      },
    } as unknown as ReconciliationService;
    const scheduler = new ReconciliationScheduler(db, reconciliation);

    const release = await holdLock(ReconciliationScheduler.LOCK);
    try {
      assert.equal(await scheduler.tick(48), null, '다른 Pod 가 쥐고 있으면 돌지 않는다');
    } finally {
      await release();
    }
    assert.equal(runs, 0);
    assert.deepEqual(await scheduler.tick(48), { checked: 0, opened: 0, autoResolved: 0, stillOpen: 0 });
    assert.equal(runs, 1);
    // 끝나면 잠금을 놓는다 — 다음 주기에 다시 잡을 수 있어야 한다.
    assert.notEqual(await scheduler.tick(48), null);
  });
});
