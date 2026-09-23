import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Reconciliation Center 통합 테스트 — 실제 PostgreSQL 이 필요하다.
 * DB 가 없으면 전부 skip 한다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
let applicantId: string;

const service = () => new ReconciliationService(db, new AuditService());

/** 테스트 전용 원서. 공용 개발 데이터를 건드리지 않는다. */
async function seedApplication(status = 'DRAFT'): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, CYCLE, applicantId, TYPE, DEPT, status],
  );
  return id;
}

async function seedPayment(appId: string, status = 'CONFIRMED'): Promise<void> {
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
     VALUES ($1,$2,'mock-pg',$3,55000,$4,now())`,
    [randomUUID(), appId, `TX-${randomUUID().slice(0, 12)}`, status],
  );
}

async function seedSubmission(appId: string): Promise<void> {
  await db.query(
    `INSERT INTO submission (id, application_id, application_number, requested_at,
                             payment_verified_at, finalized_at, deadline_policy_version,
                             config_version, evidence_hash)
     VALUES ($1,$2,$3,now(),now(),now(),'p-v1','c-v1','h')`,
    [randomUUID(), appId, `TEST-${randomUUID().slice(0, 12)}`],
  );
}

/**
 * 정리.
 *
 * 원서 행을 먼저 잠근다. 다른 테스트의 대조가 동시에 돌면서 이 원서에 예외를
 * 새로 달 수 있고, 그러면 예외를 지운 뒤 원서를 지우는 사이에 새 예외가 끼어들어
 * 외래키 위반이 난다. 부모 행을 FOR UPDATE 로 잡으면 그 틈이 닫힌다.
 */
async function cleanup(appId: string): Promise<void> {
  await db.tx(async (client) => {
    await client.query(`SELECT id FROM application WHERE id = $1 FOR UPDATE`, [appId]);
    await client.query(`DELETE FROM reconciliation_exception WHERE application_id = $1`, [appId]);
    await client.query(`DELETE FROM audit_event WHERE application_id = $1`, [appId]);
    await client.query(
      `DELETE FROM payment_event WHERE payment_id IN
         (SELECT id FROM payment WHERE application_id = $1)`,
      [appId],
    );
    await client.query(`DELETE FROM payment WHERE application_id = $1`, [appId]);
    await client.query(`DELETE FROM submission WHERE application_id = $1`, [appId]);
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
    [applicantId, `subj-recon-${applicantId.slice(0, 8)}`],
  );
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
  await db.onApplicationShutdown();
});

describe('4-way 대조 (v1.1 §A4·§B18)', () => {
  it('결제는 확인됐는데 접수 기록이 없으면 CRITICAL 로 잡는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // 돈은 나갔는데 접수가 안 된 상태. 이 제품이 가장 두려워하는 상황이다.
    const appId = await seedApplication('PAID');
    await seedPayment(appId);

    try {
      const findings = await service().detect(48);
      const hit = findings.find(
        (f) => f.applicationId === appId && f.type === 'PAYMENT_CONFIRMED_WITHOUT_SUBMISSION',
      );
      assert.ok(hit, '결제만 있고 접수가 없는 상태를 놓치면 안 된다');
      assert.equal(hit.severity, 'CRITICAL');
    } finally {
      await cleanup(appId);
    }
  });

  it('접수됐는데 확인된 결제가 없으면 CRITICAL 로 잡는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('FINALIZED');
    await seedSubmission(appId);

    try {
      const findings = await service().detect(48);
      const hit = findings.find(
        (f) => f.applicationId === appId && f.type === 'SUBMISSION_WITHOUT_CONFIRMED_PAYMENT',
      );
      assert.ok(hit);
      assert.equal(hit.severity, 'CRITICAL');
    } finally {
      await cleanup(appId);
    }
  });

  it('Submission 은 있는데 상태가 FINALIZED 가 아니면 잡는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    await seedPayment(appId);
    await seedSubmission(appId);

    try {
      const findings = await service().detect(48);
      const hit = findings.find(
        (f) => f.applicationId === appId && f.type === 'SUBMISSION_WITHOUT_FINALIZED_STATUS',
      );
      assert.ok(hit, '상태와 접수 원장이 어긋난 것을 놓치면 안 된다');
    } finally {
      await cleanup(appId);
    }
  });

  it('결제 UNKNOWN 이 오래되면 잡는다 (§B4)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAYMENT_PENDING');
    await db.query(
      `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, updated_at)
       VALUES ($1,$2,'mock-pg',$3,55000,'UNKNOWN', now() - interval '2 hours')`,
      [randomUUID(), appId, `TX-${randomUUID().slice(0, 12)}`],
    );

    try {
      const findings = await service().detect(48);
      const hit = findings.find(
        (f) => f.applicationId === appId && f.type === 'PAYMENT_STATE_UNKNOWN_STALE',
      );
      assert.ok(hit, '확인 못 한 결제를 방치하면 재결제 문의가 몰린다');
      assert.equal(hit.severity, 'HIGH');
    } finally {
      await cleanup(appId);
    }
  });

  it('정상 건은 큐에 올리지 않는다 — 신호가 묻히면 안 된다 (§B18)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('FINALIZED');
    await seedPayment(appId);
    await seedSubmission(appId);

    try {
      const findings = await service().detect(48);
      assert.equal(
        findings.filter((f) => f.applicationId === appId).length,
        0,
        '정상 건이 큐에 올라가면 실제 사고가 묻힌다',
      );
    } finally {
      await cleanup(appId);
    }
  });
});

describe('Exception Queue 운영 (v1.1 §C2·§B16)', () => {
  it('같은 불일치를 두 번 열지 않는다 (D-25 — 부분 유니크 인덱스)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    await seedPayment(appId);

    try {
      await service().reconcile(48);
      await service().reconcile(48);

      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM reconciliation_exception
          WHERE application_id = $1 AND exception_type = 'PAYMENT_CONFIRMED_WITHOUT_SUBMISSION'`,
        [appId],
      );
      assert.equal(Number(rows[0]!.n), 1, '대조를 돌릴 때마다 쌓이면 큐를 읽을 수 없다');
    } finally {
      await cleanup(appId);
    }
  });

  it('해소된 건은 AUTO_RESOLVED 로 닫는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    await seedPayment(appId);

    try {
      await service().reconcile(48);

      // 늦게 접수가 완료된 상황. PG callback 지연이면 실제로 이렇게 풀린다.
      await seedSubmission(appId);
      await db.query(`UPDATE application SET status = 'FINALIZED' WHERE id = $1`, [appId]);
      await service().reconcile(48);

      const { rows } = await db.query<{ state: string }>(
        `SELECT state FROM reconciliation_exception
          WHERE application_id = $1 AND exception_type = 'PAYMENT_CONFIRMED_WITHOUT_SUBMISSION'`,
        [appId],
      );
      assert.equal(rows[0]?.state, 'AUTO_RESOLVED', '풀린 건을 큐에 두면 실제 문제가 묻힌다');
    } finally {
      await cleanup(appId);
    }
  });

  it('사유 없이 수동 해소할 수 없다 (§B16)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    const exId = randomUUID();
    await db.query(
      `INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,'TEST_TYPE','HIGH','OPEN','{}'::jsonb)`,
      [exId, appId],
    );

    try {
      await assert.rejects(
        service().resolve(exId, 'operator@univ-a', 'MANUAL_FIX', '   '),
        (err: { problem?: { status: number } }) => err.problem?.status === 400,
      );
    } finally {
      await cleanup(appId);
    }
  });

  it('수동 해소는 before/after 와 사유를 감사에 남긴다 (§B16)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    const exId = randomUUID();
    await db.query(
      `INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,'TEST_TYPE','HIGH','OPEN','{}'::jsonb)`,
      [exId, appId],
    );

    try {
      await service().resolve(exId, 'operator@univ-a', 'PG_LATE_CALLBACK', 'PG 콜백 지연 확인');

      const { rows } = await db.query<{
        details_redacted: { before?: string; after?: string; reason?: string };
      }>(
        `SELECT details_redacted FROM audit_event
          WHERE application_id = $1 AND action = 'ADMIN_CHANGED_CONFIG'
          ORDER BY occurred_at DESC LIMIT 1`,
        [appId],
      );
      assert.equal(rows[0]?.details_redacted?.before, 'OPEN');
      assert.equal(rows[0]?.details_redacted?.after, 'RESOLVED');
      assert.equal(rows[0]?.details_redacted?.reason, 'PG 콜백 지연 확인');
    } finally {
      await cleanup(appId);
    }
  });

  it('이미 처리된 항목은 다시 해소할 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const appId = await seedApplication('PAID');
    const exId = randomUUID();
    await db.query(
      `INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,'TEST_TYPE','HIGH','OPEN','{}'::jsonb)`,
      [exId, appId],
    );

    try {
      await service().resolve(exId, 'operator@univ-a', 'FIX', '첫 처리');
      await assert.rejects(
        service().resolve(exId, 'operator2@univ-a', 'FIX', '두 번째 처리'),
        (err: { problem?: { status: number } }) => err.problem?.status === 400,
      );
    } finally {
      await cleanup(appId);
    }
  });
});
