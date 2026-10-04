import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import { PaymentStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { PostgresIdempotencyStore } from '../../common/idempotency/postgres-idempotency.store';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { ClockMonitor, serverClock } from '../../common/time/server-clock';
import { grantActiveConsents } from '../../test-support/consents';
import { breakGlass } from '../../test-support/break-glass';
import { ActivationRecorder } from '../activation/activation-recorder';
import { ActivationSigner } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
import { FormSchemaService } from '../config/form-schema.service';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { DeadlineService } from '../deadline/deadline.service';
import { DocumentService } from '../document/document.service';
import { FileInspector } from '../document/file-inspector';
import { ObjectStorage } from '../document/object-storage';
import { FinalizationService } from '../finalization/finalization.service';
import { MockPaymentProvider, SettlementEntry } from '../payment/payment.provider';
import { PaymentService } from '../payment/payment.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ApplicationStateService } from './application-state.service';
import { ApplicationRepository } from './application.repository';
import { ProfileVaultClient } from './profile-vault.client';

/**
 * 원서 흐름 전체 — 상태머신·결제·서류·시각이 서로 이어지는가 (D-55 · §A2 · §A9 · §B4)
 *
 * 각 부분은 따로 시험되고 있었지만 **서로 연결되지 않은 곳**이 있었다. 원서 상태는 DRAFT 에서
 * 바로 FINALIZED 로 갔고(READY·PAYMENT_PENDING·PAID 가 쓰이지 않았다), 한 원서에 결제창을 몇 개든
 * 열 수 있었고, 결제를 시작한 원서를 고칠 수 있었고, 접수 기록의 clock offset 은 늘 0 이었다.
 *
 * 개발 시드의 2027 수시 · EARLY 전형을 쓴다 (활성 마감 정책 · 추가문항 · 선택 서류 TRANSCRIPT).
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const COMPLETE = { highSchool: '원서고등학교', graduationYear: 2026, academicNote: '열 글자를 넘는 자기소개입니다.' };

let db: Db;
let available = false;
const apps: string[] = [];
const applicants: string[] = [];
const extraDepartments: string[] = [];

/** 정산 목록을 시험이 정하는 PG. 나머지는 Mock 과 같다. */
class LedgerPg extends MockPaymentProvider {
  ledger: SettlementEntry[] | null = null;
  override async reconcile(from: Date, to: Date): Promise<SettlementEntry[]> {
    return this.ledger ?? super.reconcile(from, to);
  }
}

/** 모듈이 기동할 때처럼 서비스를 잇는다. `autoFinalize: false` 면 결제 확정 뒤 접수 훅을 걸지 않는다. */
function wire(opts: { autoFinalize?: boolean } = {}) {
  const audit = new AuditService();
  const forms = new FormSchemaService(db);
  const breakers = new DependencyBreakers();
  const provider = new LedgerPg();
  const payments = new PaymentService(db, provider, audit, breakers);
  const recorder = new ActivationRecorder(db, new ActivationSigner(), audit);
  const deadline = new DeadlineService(new DeadlinePolicyRepository(db, recorder));
  const finalization = new FinalizationService(db, payments, deadline, forms, audit);
  if (opts.autoFinalize !== false) finalization.onModuleInit();
  const repo = new ApplicationRepository(db, audit, new ApplicationStateService(), new ProfileVaultClient(breakers));
  const documents = new DocumentService(db, new ObjectStorage(), new FileInspector(), audit, forms);
  const reconciliation = new ReconciliationService(db, audit, provider, payments, breakers);
  return { payments, finalization, repo, documents, reconciliation, provider };
}

async function seedApplicant(): Promise<{ applicantId: string; subjectToken: string }> {
  const applicantId = randomUUID();
  const subjectToken = `subj-flow-${applicantId.slice(0, 8)}`;
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1,$2,'\\x00','v1')`,
    [applicantId, subjectToken],
  );
  applicants.push(applicantId);
  return { applicantId, subjectToken };
}

async function seedApplication(opts: { status?: string; fields?: Record<string, unknown> } = {}) {
  const { applicantId } = await seedApplicant();
  const id = randomUUID();
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, CYCLE, applicantId, TYPE, DEPT, opts.status ?? 'DRAFT'],
  );
  apps.push(id);
  await grantActiveConsents(db, id, CYCLE);
  for (const [code, value] of Object.entries(opts.fields ?? COMPLETE)) {
    await db.query(
      `INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json)
       VALUES ($1,$2,$3,'test',$4)`,
      [randomUUID(), id, code, JSON.stringify(value)],
    );
  }
  return { id, applicantId };
}

async function seedPayment(appId: string, status: PaymentStatus, txId = `MOCK-FL${randomUUID().slice(0, 12).toUpperCase()}`) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,$4::varchar, CASE WHEN $4::varchar = 'CONFIRMED' THEN now() END)`,
    [id, appId, txId, status],
  );
  return { id, txId };
}

async function row(appId: string): Promise<{ status: string; version: string }> {
  const { rows } = await db.query<{ status: string; version: string }>(
    `SELECT status, version FROM application WHERE id = $1`,
    [appId],
  );
  return rows[0]!;
}

async function audits(appId: string, action: string) {
  const { rows } = await db.query<{ actor_type: string; result: string; details_redacted: Record<string, unknown> }>(
    `SELECT actor_type, result, details_redacted FROM audit_event
      WHERE application_id = $1 AND action = $2 ORDER BY occurred_at`,
    [appId, action],
  );
  return rows;
}

const problem = (status: number, code?: string) => (err: unknown) =>
  err instanceof ProblemException && err.getStatus() === status && (!code || err.problem.code === code);

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

afterEach(() => serverClock.reset());

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM reconciliation_exception WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM audit_event WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM outbox_event WHERE aggregate_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM submission WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM idempotency_record WHERE application_id = ANY($1)`, [apps]);
    await c.query(
      `DELETE FROM payment_event WHERE payment_id IN (SELECT id FROM payment WHERE application_id = ANY($1))`,
      [apps],
    );
    await c.query(`DELETE FROM payment WHERE application_id = ANY($1)`, [apps]);
    await c.query(
      `DELETE FROM document_scan WHERE document_id IN (SELECT id FROM document WHERE application_id = ANY($1))`,
      [apps],
    );
    await c.query(`DELETE FROM document WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM consent_record WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM application_field_value WHERE application_id = ANY($1)`, [apps]);
    await c.query(`DELETE FROM application WHERE id = ANY($1) OR applicant_id = ANY($2)`, [apps, applicants]);
    await c.query(`DELETE FROM applicant WHERE id = ANY($1)`, [applicants]);
    await c.query(`DELETE FROM department WHERE id = ANY($1)`, [extraDepartments]);
  });
  await db.onApplicationShutdown();
});

describe('원서 상태머신이 실제 흐름에 연결된다 (D-55)', () => {
  it('최종 검증을 통과하면 READY, 다시 저장하면 DRAFT — 내용이 바뀌면 다시 검증해야 한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { repo } = wire();
    const { id } = await seedApplication();

    const ready = await repo.markValidated(id, true);
    assert.equal(ready?.status, 'READY');

    const before = await row(id);
    const saved = await repo.patch({
      applicationId: id,
      expectedVersion: BigInt(before.version),
      fields: { academicNote: '고쳐 쓴 자기소개입니다. 열 글자 이상.' },
      schemaVersion: 'test',
    });
    assert.equal(saved.status, 'DRAFT');
    assert.equal(Number(saved.version), Number(before.version) + 1, '상태와 내용을 한 번에 바꿔 버전은 한 번만 오른다');
  });

  it('결제를 시작하면 PAYMENT_PENDING — 그 뒤로는 원서를 고칠 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments, repo } = wire();
    const { id, applicantId } = await seedApplication();

    await payments.createIntent(id, applicantId, {});
    const current = await row(id);
    assert.equal(current.status, 'PAYMENT_PENDING');

    await assert.rejects(
      repo.patch({ applicationId: id, expectedVersion: BigInt(current.version), fields: { academicNote: '' }, schemaVersion: 't' }),
      problem(409, 'VERSION_CONFLICT'),
    );
  });

  it('결제가 확정되면 PAID — 접수는 그 다음이다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire({ autoFinalize: false });
    const { id, applicantId } = await seedApplication();

    const { payment } = await payments.createIntent(id, applicantId, {});
    await payments.verify(payment.id);
    assert.equal((await row(id)).status, 'PAID');
  });

  it('결제가 실패하면 READY 로 돌아가고 새 결제를 만들 수 있다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id, applicantId } = await seedApplication();

    const first = await payments.createIntent(id, applicantId, {});
    process.env.MOCK_PG_BEHAVIOUR = 'FAIL';
    try {
      assert.equal((await payments.verify(first.payment.id)).status, 'FAILED');
    } finally {
      delete process.env.MOCK_PG_BEHAVIOUR;
    }
    assert.equal((await row(id)).status, 'READY');

    const second = await payments.createIntent(id, applicantId, {});
    assert.equal(second.created, true);
    assert.notEqual(second.payment.id, first.payment.id);
  });
});

describe('한 원서에 살아 있는 결제는 하나다 (§B4)', () => {
  it('결제하기를 다시 누르면 새 결제창이 아니라 같은 결제창을 연다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id, applicantId } = await seedApplication();

    const first = await payments.createIntent(id, applicantId, {});
    const again = await payments.createIntent(id, applicantId, {});
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.payment.id, first.payment.id);
    assert.equal(again.providerPayload.providerTxId, first.payment.providerTxId);

    const { rows } = await db.query(`SELECT 1 FROM payment WHERE application_id = $1`, [id]);
    assert.equal(rows.length, 1, '결제 기록은 하나다');
  });

  it('동시에 눌러도 결제는 하나만 생긴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id, applicantId } = await seedApplication();

    const results = await Promise.all(Array.from({ length: 5 }, () => payments.createIntent(id, applicantId, {})));
    assert.equal(new Set(results.map((r) => r.payment.id)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
  });

  it('확인 중인 결제가 있으면 새 결제를 만들지 않는다 — 다시 결제하면 이중 결제가 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id, applicantId } = await seedApplication({ status: 'PAYMENT_PENDING' });
    await seedPayment(id, 'UNKNOWN');

    await assert.rejects(payments.createIntent(id, applicantId, {}), problem(409, 'PAYMENT_IN_PROGRESS'));
  });
});

describe('접수 시각은 DB 시계, 어긋난 노드는 접수를 확정하지 않는다 (§A2·§A9)', () => {
  it('접수 기록과 감사에 이 노드의 clock offset 이 남는다 — 전에는 늘 0 이었다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments } = wire();
    const { id, applicantId } = await seedApplication();
    serverClock.record({ offsetMs: 37, uncertaintyMs: 2, dbTimeMs: Date.now() - 37 });

    const { payment } = await payments.createIntent(id, applicantId, {});
    await payments.verify(payment.id);

    assert.equal((await row(id)).status, 'FINALIZED');
    const { rows } = await db.query<{ server_clock_offset_ms: number }>(
      `SELECT server_clock_offset_ms FROM submission WHERE application_id = $1`,
      [id],
    );
    assert.equal(rows[0]?.server_clock_offset_ms, 37);
    const [finalized] = await audits(id, 'APPLICATION_FINALIZED');
    assert.deepEqual(finalized?.details_redacted.clock, { offsetMs: 37, uncertaintyMs: 2, status: 'SYNCED', source: 'db' });
  });

  it('DB 시계와 1초 넘게 어긋난 노드는 503 — 다른 Pod 가 받는다. 거절도 기록한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { finalization } = wire();
    const { id, applicantId } = await seedApplication({ status: 'PAID' });
    await seedPayment(id, 'CONFIRMED');
    serverClock.record({ offsetMs: 5_000, uncertaintyMs: 1, dbTimeMs: Date.now() - 5_000 });

    await assert.rejects(
      finalization.finalize({ applicationId: id, applicantId, requestedAt: new Date() }),
      problem(503, 'RETRYABLE'),
    );
    const { rows } = await db.query(`SELECT 1 FROM submission WHERE application_id = $1`, [id]);
    assert.equal(rows.length, 0);
    const [rejected] = await audits(id, 'FINALIZE_REQUESTED');
    assert.equal(rejected?.result, 'REJECTED');
    assert.equal(rejected?.details_redacted.code, 'RETRYABLE');
  });

  it('ClockMonitor 가 이 DB 와의 offset 을 잰다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const reading = await new ClockMonitor(db).sample();
    assert.notEqual(reading.status, 'UNMEASURED');
    assert.ok(reading.uncertaintyMs !== null && reading.uncertaintyMs >= 0);
    // 같은 PC 의 DB 다(축소 환경). 몇 초씩 어긋나 있지 않다.
    assert.ok(Math.abs(reading.offsetMs) < 5_000, `offset ${reading.offsetMs}ms`);
  });
});

describe('거절된 접수 요청도 기록한다 (§A2 · v1.0 §9)', () => {
  it('지원자가 누른 접수가 결제 미확인으로 거절되면 FINALIZE_REQUESTED REJECTED', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { finalization } = wire();
    const { id, applicantId } = await seedApplication();

    await assert.rejects(
      finalization.finalize({ applicationId: id, applicantId, requestedAt: new Date() }),
      problem(409, 'PAYMENT_NOT_CONFIRMED'),
    );
    const [rejected] = await audits(id, 'FINALIZE_REQUESTED');
    assert.equal(rejected?.actor_type, 'APPLICANT');
    assert.equal(rejected?.details_redacted.code, 'PAYMENT_NOT_CONFIRMED');
  });

  it('접수증을 발급하면 RECEIPT_ISSUED 가 남는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments, finalization } = wire();
    const { id, applicantId } = await seedApplication();
    const { payment } = await payments.createIntent(id, applicantId, {});
    await payments.verify(payment.id);
    const submission = await finalization.findSubmission(id);

    const receipt = await finalization.issueReceipt(submission!.submissionId, applicantId);
    assert.equal(receipt?.applicationNumber, submission?.applicationNumber);
    assert.equal((await audits(id, 'RECEIPT_ISSUED')).length, 1);
  });
});

describe('원서 생성·수정의 입력 대조', () => {
  it('등록된 지원자의 가명 토큰과 다른 토큰을 주장하면 403 — 남의 공통원서를 끌어올 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { repo } = wire();
    const { applicantId } = await seedApplicant();

    await assert.rejects(
      repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: DEPT, subjectToken: 'subj-someone-else' }),
      problem(403),
    );
  });

  it('등록되지 않은 지원자는 403 — 전에는 외래키 오류로 500 이었다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { repo } = wire();
    await assert.rejects(
      repo.create({ cycleId: CYCLE, applicantId: randomUUID(), admissionTypeId: TYPE, departmentId: DEPT }),
      problem(403),
    );
  });

  it('모집이 닫힌 모집단위·없는 전형으로는 원서를 만들 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { repo } = wire();
    const { applicantId } = await seedApplicant();
    const closed = randomUUID();
    extraDepartments.push(closed);
    await breakGlass((c) =>
      c.query(
        `INSERT INTO department (id, cycle_id, code, name, quota, active) VALUES ($1,$2,$3,'모집 종료 학과',10,false)`,
        [closed, CYCLE, `CL-${closed.slice(0, 6)}`],
      ),
    );

    await assert.rejects(
      repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: closed }),
      problem(400, 'VALIDATION_FAILED'),
    );
    await assert.rejects(
      repo.create({ cycleId: CYCLE, applicantId, admissionTypeId: randomUUID(), departmentId: DEPT }),
      problem(400, 'VALIDATION_FAILED'),
    );
  });
});

describe('서류는 작성 중에만, 전형이 받는 종류만 (§A5 · D-55)', () => {
  it('결제를 시작한 원서에는 서류를 올릴 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { documents } = wire();
    const { id, applicantId } = await seedApplication({ status: 'PAYMENT_PENDING' });

    await assert.rejects(
      documents.createIntent({
        applicationId: id,
        applicantId,
        documentType: 'TRANSCRIPT',
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 1024,
      }),
      problem(409),
    );
  });

  it('전형 설정에 없는 서류 종류는 받지 않고, 있는 종류는 받는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { documents } = wire();
    const { id, applicantId } = await seedApplication();
    const intent = (documentType: string) =>
      documents.createIntent({
        applicationId: id,
        applicantId,
        documentType,
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 1024,
      });

    await assert.rejects(intent('AWARD'), problem(400, 'VALIDATION_FAILED'));
    const ok = await intent('TRANSCRIPT');
    assert.ok(ok.documentId);
  });
});

describe('PG 정산 대조 (§A4·§B18) — 재확인 워커가 묻지 않는 결제', () => {
  it('콜백도 화면 확인도 없이 결제창만 연 채로 남은 결제를 PG 장부에서 찾아 접수까지 잇는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { payments, reconciliation } = wire();
    const { id, applicantId } = await seedApplication();
    const { payment } = await payments.createIntent(id, applicantId, {});
    assert.equal(payment.status, 'CREATED');

    const findings = await reconciliation.detect(1);
    assert.equal(findings.filter((f) => f.applicationId === id).length, 0);
    assert.equal((await row(id)).status, 'FINALIZED', '정산 대조가 결제를 확인했고 자동 접수가 이어졌다');
  });

  it('우리는 확정인데 PG 장부에 승인이 없으면 CRITICAL', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { reconciliation, provider } = wire();
    const { id } = await seedApplication({ status: 'PAID' });
    const { txId } = await seedPayment(id, 'CONFIRMED');
    provider.ledger = [{ providerTxId: txId, status: 'CANCELLED' }];

    const findings = (await reconciliation.detect(1)).filter((f) => f.applicationId === id);
    // 결제 확정·미접수(1번)도 함께 걸린다 — 이 원서는 둘 다 사실이다.
    assert.ok(
      findings.some((f) => f.type === 'PAYMENT_NOT_SETTLED_AT_PG' && f.severity === 'CRITICAL'),
      JSON.stringify(findings.map((f) => f.type)),
    );
  });
});

describe('멱등 기록 — 결제·서류 경로와 만료 정리 (D-11)', () => {
  it('결제·서류 ID 로 원서를 찾아 멱등 기록을 남길 수 있다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const { id } = await seedApplication();
    const { id: paymentId } = await seedPayment(id, 'CREATED');

    assert.equal(await store.applicationOf({ paymentId }), id);
    assert.equal(await store.applicationOf({ paymentId: randomUUID() }), null);
    assert.equal(await store.applicationOf({ documentId: 'not-a-uuid' }), null);
  });

  it('만료된 기록은 정리되고, 만료되지 않은 기록은 남는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const { id } = await seedApplication();
    await db.query(
      `INSERT INTO idempotency_record (id, application_id, operation, idempotency_key, request_hash, state, expires_at)
       VALUES ($1,$2,'POST:x','expired-key-000001','h','COMPLETED', now() - interval '1 hour'),
              ($3,$2,'POST:x','fresh-key-00000001','h','COMPLETED', now() + interval '1 hour')`,
      [randomUUID(), id, randomUUID()],
    );

    await store.purgeExpired();
    const { rows } = await db.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM idempotency_record WHERE application_id = $1`,
      [id],
    );
    assert.deepEqual(rows.map((r) => r.idempotency_key), ['fresh-key-00000001']);
  });
});
