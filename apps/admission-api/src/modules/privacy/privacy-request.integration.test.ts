import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { PrivacyRequestService } from './privacy-request.service';

/**
 * 정보주체 권리 요청 (문서 10 G-10, 대장 D-84) — 실제 PostgreSQL.
 *
 * 받은 요청에 번호·법정 기한(10일)이 붙고, 같은 종류의 처리 중 요청은 하나뿐이며, 요청 내용이 DB 에 평문으로
 * 남지 않는지, 처리 큐가 기한 순이고 내용을 싣지 않는지, 회신이 한 번뿐이고 사유 없는 거절이 막히는지,
 * 열람·회신이 원서 감사 체인에 남는지, 회신한 요청은 고치거나 지울 수 없는지를 본다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
/** 정정 요청에 적힌 개인정보 — DB 평문 칼럼·감사 기록·큐 줄에 나오면 안 된다 */
const DETAIL = '연락처를 010-9876-5432 로 바로잡아 주십시오';

let db: Db;
let available = false;
const applicants: string[] = [];
const applications: string[] = [];
let draftApp = '';
let draftApplicant = '';
let doneApp = '';
let doneNumber = '';

const service = () => new PrivacyRequestService(db, new AuditService());

async function newApplication(status: string): Promise<{ id: string; applicantId: string }> {
  const applicantId = randomUUID();
  const id = randomUUID();
  applicants.push(applicantId);
  applications.push(id);
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-privacy-${applicantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status, last_saved_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [id, CYCLE, applicantId, TYPE, DEPT, status],
  );
  return { id, applicantId };
}

const problem = (status: number, pattern?: RegExp) => (e: unknown) =>
  e instanceof ProblemException && e.getStatus() === status && (!pattern || pattern.test(String(e.problem.detail)));

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  const draft = await newApplication('DRAFT');
  draftApp = draft.id;
  draftApplicant = draft.applicantId;
  const done = await newApplication('FINALIZED');
  doneApp = done.id;
  doneNumber = `2099-UNIV-A-PRIVACY${randomUUID().slice(0, 4).toUpperCase()}`;
  await db.query(
    `INSERT INTO submission (id, application_id, application_number, requested_at, payment_verified_at, finalized_at,
                             deadline_policy_version, config_version, evidence_hash)
     VALUES ($1,$2,$3, now(), now(), now(), 'privacy-it', 'privacy-it', 'h')`,
    [randomUUID(), doneApp, doneNumber],
  );
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.privacy_request WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.submission WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.application WHERE id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = ANY($1::uuid[])`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('정보주체 권리 요청 (G-10, D-84)', () => {
  let correction = '';
  let deletion = '';

  it('요청에 번호와 받은 날부터 10일 기한이 붙고, 내용은 봉해서 저장한다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const { created, request } = await service().create({
      applicationId: draftApp,
      applicantId: draftApplicant,
      kind: 'CORRECTION',
      detail: `  ${DETAIL}  `,
    });
    assert.equal(created, true);
    correction = request.requestNumber;
    assert.match(correction, /^PR-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(request.status, 'RECEIVED');
    assert.equal(request.detail, DETAIL, '앞뒤 공백을 걷은 내용을 그대로 돌려준다');
    assert.equal(new Date(request.dueAt).getTime() - new Date(request.receivedAt).getTime(), 10 * 86_400_000);

    const raw = await db.query<{ detail_ciphertext: Buffer }>(
      `SELECT detail_ciphertext FROM privacy_request WHERE request_number = $1`,
      [correction],
    );
    assert.ok(raw.rows[0]?.detail_ciphertext.length);
    assert.equal(raw.rows[0]!.detail_ciphertext.toString('utf8').includes('010-9876'), false, 'DB 에 평문이 없다');

    const audit = await db.query<{ action: string; details: string }>(
      `SELECT action, details_redacted::text AS details FROM audit_event WHERE application_id = $1 ORDER BY occurred_at`,
      [draftApp],
    );
    assert.equal(audit.rows.at(-1)?.action, 'PRIVACY_REQUEST_RECEIVED');
    assert.ok(audit.rows.at(-1)!.details.includes(correction));
    assert.equal(audit.rows.at(-1)!.details.includes('010-9876'), false, '감사 기록에 요청 내용이 없다');
  });

  it('같은 종류의 처리 중 요청을 다시 보내면 앞 요청을 돌려준다 — 다른 종류는 새 요청', async (t) => {
    if (!available) return t.skip('DB 없음');
    const again = await service().create({ applicationId: draftApp, applicantId: draftApplicant, kind: 'CORRECTION', detail: '다른 내용' });
    assert.equal(again.created, false);
    assert.equal(again.request.requestNumber, correction);
    assert.equal(again.request.detail, DETAIL);

    const del = await service().create({ applicationId: draftApp, applicantId: draftApplicant, kind: 'DELETION' });
    assert.equal(del.created, true);
    assert.equal(del.request.detail, null);
    deletion = del.request.requestNumber;

    const list = await service().listForApplication(draftApp);
    assert.deepEqual(list.map((r) => r.requestNumber).sort(), [correction, deletion].sort());
  });

  it('모르는 종류·내용 없는 정정·너무 긴 내용은 400', async (t) => {
    if (!available) return t.skip('DB 없음');
    const base = { applicationId: doneApp, applicantId: 'x' };
    await assert.rejects(service().create({ ...base, kind: 'EXPORT' }), problem(400));
    await assert.rejects(service().create({ ...base, kind: 'CORRECTION', detail: '   ' }), problem(400, /바로잡을지/));
    await assert.rejects(service().create({ ...base, kind: 'ACCESS', detail: 'a'.repeat(1001) }), problem(400));
  });

  it('처리 큐는 기한이 급한 것부터이고, 줄에는 요청 내용이 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    // 접수 원서의 열람 요청을 받고, 기한을 지난 것처럼 받은 시각을 앞당긴 요청을 하나 더 만든다(트리거를 끄는 시험 경로)
    const access = await service().create({ applicationId: doneApp, applicantId: 'subj', kind: 'ACCESS' });
    await breakGlass((c) =>
      c.query(
        `UPDATE kadmission.privacy_request SET received_at = now() - interval '12 days', due_at = now() - interval '2 days'
          WHERE request_number = $1`,
        [access.request.requestNumber],
      ),
    );

    const queue = await service().queue('OPEN');
    const mine = queue.items.filter((i) => [correction, deletion, access.request.requestNumber].includes(i.requestNumber));
    assert.equal(mine[0]?.requestNumber, access.request.requestNumber, '기한 지난 요청이 맨 앞');
    assert.equal(mine[0]?.overdue, true);
    assert.ok(mine[0]!.daysLeft < 0);
    assert.equal(mine[0]?.applicationNumber, doneNumber);
    assert.match(mine[0]!.supportCode, /^[0-9A-HJKMNP-TV-Z]{10}$/);
    const fresh = mine.find((i) => i.requestNumber === correction)!;
    assert.equal(fresh.overdue, false);
    assert.equal(fresh.applicationNumber, null, '접수 전 원서는 접수번호가 없다');
    assert.ok(fresh.daysLeft >= 9 && fresh.daysLeft <= 10);
    assert.ok(mine.every((i) => i.detail === null && i.resultNote === null));
    assert.equal(JSON.stringify(queue).includes('010-9876'), false);
    assert.ok(queue.counts.open >= 3);
    assert.ok(queue.counts.overdue >= 1);
  });

  it('담당자가 한 건을 열면 내용이 보이고 열람이 원서 체인에 남는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const opened = await service().open(correction.toLowerCase(), 'privacy-it-admin');
    assert.equal(opened.detail, DETAIL);
    const audit = await db.query<{ action: string; actor_id: string; purpose: string }>(
      `SELECT action, actor_id, details_redacted->>'purpose' AS purpose FROM audit_event
        WHERE application_id = $1 ORDER BY occurred_at`,
      [draftApp],
    );
    assert.deepEqual(audit.rows.at(-1), { action: 'ADMIN_VIEWED_PII', actor_id: 'privacy-it-admin', purpose: 'PRIVACY_REQUEST' });
    await assert.rejects(service().open('PR-20000101-000000', 'x'), problem(404));
    await assert.rejects(service().open('not-a-number', 'x'), problem(400));
  });

  it('사유 없는 거절·일부 처리는 막고, 회신은 한 번만 — 지원자 화면에 그대로 보인다', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(
      service().decide({ requestNumber: deletion, outcome: 'REFUSED', note: '불가', adminId: 'privacy-it-admin' }),
      problem(400, /사유/),
    );
    await assert.rejects(
      service().decide({ requestNumber: deletion, outcome: 'APPROVED', note: '처리했습니다', adminId: 'privacy-it-admin' }),
      problem(400),
    );
    const reason = '작성 중인 원서와 그 항목 값을 모두 지웠습니다. 감사 기록은 법령에 따라 보존합니다.';
    const decided = await service().decide({ requestNumber: deletion, outcome: 'PARTIALLY_COMPLETED', note: reason, adminId: 'privacy-it-admin' });
    assert.equal(decided.status, 'PARTIALLY_COMPLETED');
    assert.equal(decided.decidedBy, 'privacy-it-admin');
    assert.equal(decided.resultNote, reason);

    await assert.rejects(
      service().decide({ requestNumber: deletion, outcome: 'COMPLETED', note: '다시', adminId: 'other' }),
      problem(409),
    );

    const seen = (await service().listForApplication(draftApp)).find((r) => r.requestNumber === deletion)!;
    assert.equal(seen.status, 'PARTIALLY_COMPLETED');
    assert.equal(seen.resultNote, reason);
    assert.ok(seen.decidedAt);

    const audit = await db.query<{ action: string; outcome: string; late: string }>(
      `SELECT action, details_redacted->>'outcome' AS outcome, details_redacted->>'late' AS late FROM audit_event
        WHERE application_id = $1 ORDER BY occurred_at`,
      [draftApp],
    );
    assert.deepEqual(audit.rows.at(-1), { action: 'PRIVACY_REQUEST_DECIDED', outcome: 'PARTIALLY_COMPLETED', late: 'false' });

    const done = await service().queue('DONE');
    assert.ok(done.items.some((i) => i.requestNumber === deletion));
    assert.equal((await service().queue('OPEN')).items.some((i) => i.requestNumber === deletion), false);
  });

  it('회신한 요청은 고칠 수 없고, 어떤 요청도 지울 수 없다 — 앱 역할도 내용 칸은 못 바꾼다', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(
      db.query(`UPDATE privacy_request SET status = 'COMPLETED' WHERE request_number = $1`, [deletion]),
      /바꿀 수 없다|permission denied/,
    );
    await assert.rejects(
      db.query(`UPDATE privacy_request SET due_at = due_at + interval '30 days' WHERE request_number = $1`, [correction]),
      /바꿀 수 없다|permission denied/,
    );
    await assert.rejects(
      db.query(`DELETE FROM privacy_request WHERE request_number = $1`, [correction]),
      /지울 수 없다|permission denied/,
    );
  });
});
