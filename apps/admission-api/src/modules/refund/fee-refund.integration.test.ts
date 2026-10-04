import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { FeeRefundService } from './fee-refund.service';

/**
 * 전형료 반환·면제/감액 신청 (시행령 제42조의3, 문서 10 G-5, 대장 D-89) — 실제 PostgreSQL.
 *
 * 확인된 결제가 있는 원서만 받고, 계좌는 봉해 DB·감사에 평문이 없으며 화면에는 끝 네 자리만 보이는지,
 * 검토 중 신청은 하나뿐인지, 큐에 계좌 원문이 없고 한 건을 열면 열람이 남는지, 결정이 한 번뿐이고 금액이 낸 금액을 넘지 못하는지,
 * 결정한 신청은 고치거나 지울 수 없는지를 본다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const ACCOUNT = { bank: '원서은행', holder: '김지원', number: '110-234-567890' };

let db: Db;
let available = false;
const applicants: string[] = [];
const applications: string[] = [];
let paidApp = '';
let unpaidApp = '';

const service = () => new FeeRefundService(db, new AuditService());

async function newApplication(status: string, paid: boolean): Promise<string> {
  const applicantId = randomUUID();
  const id = randomUUID();
  applicants.push(applicantId);
  applications.push(id);
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-refund-${applicantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, CYCLE, applicantId, TYPE, DEPT, status],
  );
  if (paid) {
    await db.query(
      `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status, verified_at)
       VALUES ($1,$2,'mock',$3, 50000, 'CONFIRMED', now())`,
      [randomUUID(), id, `tx-refund-${id.slice(0, 8)}`],
    );
  }
  return id;
}

const problem = (status: number, pattern?: RegExp) => (e: unknown) =>
  e instanceof ProblemException && e.getStatus() === status && (!pattern || pattern.test(String(e.problem.detail)));

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  paidApp = await newApplication('FINALIZED', true);
  unpaidApp = await newApplication('DRAFT', false);
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.fee_refund_request WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.payment WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.application WHERE id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = ANY($1::uuid[])`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('전형료 반환·면제/감액 신청 (G-5, D-89)', () => {
  let number = '';

  it('결제가 확인되지 않은 원서는 받지 않고, 계좌 형식이 틀리면 400', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(service().create({ applicationId: unpaidApp, applicantId: 'x', reason: 'OVERPAID', method: 'VISIT' }), problem(409, /결제가 확인된/));
    await assert.rejects(service().create({ applicationId: paidApp, applicantId: 'x', reason: 'REFUND_ALL', method: 'VISIT' }), problem(400));
    await assert.rejects(
      service().create({ applicationId: paidApp, applicantId: 'x', reason: 'EXEMPTION', method: 'ACCOUNT', account: { ...ACCOUNT, number: '계좌' } }),
      problem(400, /계좌번호/),
    );
  });

  it('계좌는 봉하고 끝 네 자리만 보인다 — DB·감사에 평문이 없고, 검토 중 신청은 하나다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const { created, request } = await service().create({
      applicationId: paidApp,
      applicantId: 'subj',
      reason: 'EXEMPTION',
      method: 'ACCOUNT',
      account: ACCOUNT,
      detail: '기초생활수급자 증명서를 서류로 올렸습니다.',
    });
    assert.equal(created, true);
    number = request.requestNumber;
    assert.match(number, /^FR-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(request.accountMasked, '********7890');
    assert.equal(request.paidAmount, 50000);
    assert.equal(JSON.stringify(request).includes('234-567890'), false, '지원자 화면 응답에도 계좌 원문이 없다');

    const raw = await db.query<{ account_ciphertext: Buffer }>(`SELECT account_ciphertext FROM fee_refund_request WHERE request_number = $1`, [number]);
    assert.equal(raw.rows[0]!.account_ciphertext.toString('utf8').includes('567890'), false);
    const audit = await db.query<{ action: string; details: string }>(
      `SELECT action, details_redacted::text AS details FROM audit_event WHERE application_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [paidApp],
    );
    assert.equal(audit.rows[0]?.action, 'FEE_REFUND_REQUESTED');
    assert.equal(audit.rows[0]!.details.includes('567890'), false);

    const again = await service().create({ applicationId: paidApp, applicantId: 'subj', reason: 'OVERPAID', method: 'VISIT' });
    assert.equal(again.created, false);
    assert.equal(again.request.requestNumber, number);
  });

  it('큐에는 계좌 원문이 없고, 한 건을 열면 계좌가 보이며 열람이 원서 체인에 남는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const queue = await service().queue('OPEN');
    const mine = queue.items.find((i) => i.requestNumber === number)!;
    assert.equal(mine.account, null);
    assert.equal(mine.detail, null);
    assert.ok(queue.counts.open >= 1);
    const opened = await service().open(number.toLowerCase(), 'refund-it-admin');
    assert.deepEqual(opened.account, ACCOUNT);
    const audit = await db.query<{ action: string; purpose: string }>(
      `SELECT action, details_redacted->>'purpose' AS purpose FROM audit_event WHERE application_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [paidApp],
    );
    assert.deepEqual(audit.rows[0], { action: 'ADMIN_VIEWED_PII', purpose: 'FEE_REFUND' });
  });

  it('결정은 한 번 — 낸 금액을 넘는 승인·사유 없는 거절은 막고, 결정한 신청은 고치거나 지울 수 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(service().decide({ requestNumber: number, outcome: 'APPROVED', amount: 60000, note: '반환합니다', adminId: 'a' }), problem(400, /많습니다/));
    await assert.rejects(service().decide({ requestNumber: number, outcome: 'APPROVED', amount: 0, note: '반환합니다', adminId: 'a' }), problem(400));
    await assert.rejects(service().decide({ requestNumber: number, outcome: 'REJECTED', note: '불가', adminId: 'a' }), problem(400, /사유/));
    const done = await service().decide({ requestNumber: number, outcome: 'APPROVED', amount: 50000, note: '알려 주신 계좌로 이체합니다.', adminId: 'refund-it-admin' });
    assert.equal(done.status, 'APPROVED');
    assert.equal(done.approvedAmount, 50000);
    assert.equal(done.resultNote, '알려 주신 계좌로 이체합니다.');
    await assert.rejects(service().decide({ requestNumber: number, outcome: 'REJECTED', note: '다시 결정합니다 — 사유', adminId: 'b' }), problem(409));

    const seen = (await service().listForApplication(paidApp))[0]!;
    assert.equal(seen.status, 'APPROVED');
    assert.equal(seen.resultNote, '알려 주신 계좌로 이체합니다.');

    await assert.rejects(db.query(`UPDATE fee_refund_request SET approved_amount = 1 WHERE request_number = $1`, [number]), /바꿀 수 없다|permission denied/);
    await assert.rejects(db.query(`DELETE FROM fee_refund_request WHERE request_number = $1`, [number]), /지울 수 없다|permission denied/);
  });
});
