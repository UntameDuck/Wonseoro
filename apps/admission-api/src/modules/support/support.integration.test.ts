import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { formatSupportCode } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import type { DeadlineService } from '../deadline/deadline.service';
import { IncidentService } from '../incident/incident.service';
import { SupportService, type SupportView } from './support.service';

/**
 * 개인정보 최소 상담 조회 (T-M6-07, 노션 §01 B11, 대장 D-79) — 실제 PostgreSQL.
 *
 * 응답 **키 전수** 가 허용 목록 안에 있는지, 원서 식별자·파일 이름 같은 값이 응답 어디에도 없는지,
 * 조회마다 증적번호·저장본·해시·감사 체인이 남는지, 증적번호로 그때 내용이 그대로 열리는지를 본다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
/** 시험 지원자가 올린 서류의 파일 이름 — 응답에 나오면 안 된다 */
const FILE_NAME = '홍길동_주민등록등본_010-1234-5678.pdf';

let db: Db;
let available = false;
const applicants: string[] = [];
const applications: string[] = [];
let draftApp = '';
let draftCode = '';
let doneApp = '';
let doneNumber = '';
let paymentId = '';

/** 허용된 응답 키 — 대장 D-79 ③. 늘리려면 대장부터 고친다 */
const ALLOWED_KEYS = new Set([
  'evidenceNumber', 'lookedUpAt', 'reason', 'lookupKind', 'universityName', 'cycleName',
  'application', 'status', 'summary', 'lastSavedAt',
  'submission', 'submitted', 'applicationNumber', 'finalizedAt',
  'payment', 'amount', 'requestedAt', 'verifiedAt', 'guidance',
  'documents', 'available', 'scanning', 'rejected', 'uploading',
  'centralSync', 'pending', 'sent', 'lastSentAt',
  'deadline', 'deadlineAt',
  'incidents', 'severity', 'title', 'startsAt',
  'timeline', 'at', 'what', 'result',
  'agentGuidance',
]);

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** 마감 정책이 없어도 상담은 된다 — 시험은 정책 유무와 무관하게 고정 값 */
const deadline = { snapshot: async () => ({ deadlineAt: '2099-12-31T09:00:00.000Z' }) } as unknown as DeadlineService;

function service() {
  const audit = new AuditService();
  return new SupportService(db, audit, deadline, new IncidentService(db, audit));
}

async function newApplication(status: string): Promise<{ id: string; code: string }> {
  const applicantId = randomUUID();
  const id = randomUUID();
  applicants.push(applicantId);
  applications.push(id);
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-support-${applicantId.slice(0, 8)}`],
  );
  const { rows } = await db.query<{ support_code: string }>(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status, last_saved_at)
     VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING support_code`,
    [id, CYCLE, applicantId, TYPE, DEPT, status],
  );
  return { id, code: rows[0]!.support_code };
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  const draft = await newApplication('PAYMENT_PENDING');
  draftApp = draft.id;
  draftCode = draft.code;
  paymentId = randomUUID();
  await db.query(
    `INSERT INTO payment (id, application_id, provider, provider_tx_id, amount, status)
     VALUES ($1,$2,'mock',$3, 50000, 'UNKNOWN')`,
    [paymentId, draftApp, `tx-support-${paymentId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO document (id, application_id, document_type, object_key, original_filename, media_type, size_bytes, sha256_hex, status)
     VALUES ($1,$2,'TRANSCRIPT',$3,$4,'application/pdf',10,$5,'REJECTED')`,
    [randomUUID(), draftApp, `support-it/${draftApp}`, FILE_NAME, 'a'.repeat(64)],
  );

  const done = await newApplication('FINALIZED');
  doneApp = done.id;
  doneNumber = `2099-UNIV-A-SUPPORT${randomUUID().slice(0, 4).toUpperCase()}`;
  await db.query(
    `INSERT INTO submission (id, application_id, application_number, requested_at, payment_verified_at, finalized_at,
                             deadline_policy_version, config_version, evidence_hash)
     VALUES ($1,$2,$3, now(), now(), now(), 'support-it', 'support-it', 'h')`,
    [randomUUID(), doneApp, doneNumber],
  );
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.support_lookup WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.submission WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.payment WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.document WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.application WHERE id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = ANY($1::uuid[])`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('개인정보 최소 상담 조회 (T-M6-07, D-79)', () => {
  let first: SupportView;

  it('원서마다 상담 확인번호가 있고 바꿀 수 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    assert.match(draftCode, /^[0-9A-HJKMNP-TV-Z]{10}$/);
    await assert.rejects(
      db.query(`UPDATE application SET support_code = '0000000000' WHERE id = $1`, [draftApp]),
      /바꿀 수 없다/,
    );
  });

  it('상담 확인번호(하이픈·소문자 그대로)로 찾고, 허용 목록 밖의 키·값이 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    first = await service().lookup({
      key: formatSupportCode(draftCode).toLowerCase(),
      reason: 'PAYMENT',
      agentId: 'support-it-agent',
    });
    assert.equal(first.lookupKind, 'SUPPORT_CODE');
    assert.match(first.evidenceNumber, /^SR-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.equal(first.application.status, 'PAYMENT_PENDING');
    assert.equal(first.submission.submitted, false);
    assert.equal(first.payment.status, 'UNKNOWN');
    assert.equal(first.payment.amount, 50000);
    assert.deepEqual(first.documents, { available: 0, scanning: 0, rejected: 1, uploading: 0 });
    assert.ok(first.agentGuidance.some((g) => /다시 결제하지/.test(g)), '확인 중 결제는 재결제를 막는 안내');
    assert.ok(first.agentGuidance.some((g) => /서류/.test(g)), '통과 못 한 서류 안내');

    const extra = [...keysOf(first)].filter((k) => !ALLOWED_KEYS.has(k));
    assert.deepEqual(extra, [], '허용 목록 밖의 응답 키');
    const text = JSON.stringify(first);
    for (const forbidden of [draftApp, paymentId, FILE_NAME, 'TRANSCRIPT', draftCode, 'tx-support-', 'subj-support-', TYPE, DEPT]) {
      assert.equal(text.includes(forbidden), false, `응답에 실리면 안 되는 값: ${forbidden}`);
    }
  });

  it('조회마다 증적번호·저장본·해시가 남고 원서 감사 체인에 "상담 조회" 가 잇는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const stored = await db.query<{ agent_id: string; reason: string; lookup_kind: string; snapshot_hash: string }>(
      `SELECT agent_id, reason, lookup_kind, snapshot_hash FROM support_lookup WHERE evidence_number = $1`,
      [first.evidenceNumber],
    );
    assert.equal(stored.rows[0]?.agent_id, 'support-it-agent');
    assert.equal(stored.rows[0]?.reason, 'PAYMENT');
    assert.equal(stored.rows[0]?.lookup_kind, 'SUPPORT_CODE');

    const audit = await db.query<{ action: string; actor_id: string; evidence: string }>(
      `SELECT action, actor_id, details_redacted->>'evidenceNumber' AS evidence
         FROM audit_event WHERE application_id = $1 ORDER BY occurred_at`,
      [draftApp],
    );
    assert.deepEqual(audit.rows.at(-1), { action: 'SUPPORT_LOOKUP', actor_id: 'support-it-agent', evidence: first.evidenceNumber });

    // 다음 조회는 새 증적번호이고 처리 이력에 앞 조회가 보인다
    const second = await service().lookup({ key: draftCode, reason: 'STATUS', agentId: 'support-it-agent-2' });
    assert.notEqual(second.evidenceNumber, first.evidenceNumber);
    assert.ok(second.timeline.some((e) => e.what === '상담 조회'));
  });

  it('증적번호로 그때 안내한 내용을 그대로 다시 열고, 저장본은 고치거나 지울 수 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const again = await service().reopen(first.evidenceNumber.toLowerCase());
    assert.equal(again.intact, true);
    const { snapshotHash: _hash, intact: _intact, ...view } = again;
    assert.deepEqual(view, first, '다시 연 내용이 그때 응답과 같다');

    await assert.rejects(
      db.query(`UPDATE support_lookup SET reason = 'OTHER' WHERE evidence_number = $1`, [first.evidenceNumber]),
      /추가만 가능하다|permission denied/,
    );
    await assert.rejects(
      db.query(`DELETE FROM support_lookup WHERE evidence_number = $1`, [first.evidenceNumber]),
      /추가만 가능하다|permission denied/,
    );
  });

  it('접수번호로 찾으면 접수 완료와 접수번호를 보인다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const view = await service().lookup({ key: ` ${doneNumber.toLowerCase()} `, reason: 'STATUS', agentId: 'support-it-agent' });
    assert.equal(view.lookupKind, 'APPLICATION_NUMBER');
    assert.equal(view.submission.submitted, true);
    assert.equal(view.submission.applicationNumber, doneNumber);
    assert.match(view.application.summary, /접수가 완료되었습니다/);
    assert.equal(JSON.stringify(view).includes(doneApp), false);
  });

  it('없는 번호는 접수번호·상담 확인번호 모두 같은 404, 사유 분류가 없으면 400', async (t) => {
    if (!available) return t.skip('DB 없음');
    const notFound = (e: unknown) =>
      e instanceof ProblemException && e.getStatus() === 404 && /번호를 다시 확인해 주십시오/.test(String(e.problem.detail));
    // 다른 대학의 접수번호는 이 대학 DB 에 없다 — 같은 404 (대학 경계)
    await assert.rejects(service().lookup({ key: '2099-UNIV-B-ZZZZZZZZZZ', reason: 'STATUS', agentId: 'x' }), notFound);
    await assert.rejects(service().lookup({ key: 'ZZZZZ-ZZZZZ', reason: 'STATUS', agentId: 'x' }), notFound);
    await assert.rejects(service().lookup({ key: draftApp, reason: 'STATUS', agentId: 'x' }), notFound, '원서 UUID 로는 찾지 않는다');
    await assert.rejects(
      service().lookup({ key: draftCode, reason: '홍길동 연락처 확인', agentId: 'x' }),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 400,
    );
    await assert.rejects(
      service().reopen('SR-20000101-000000'),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 404,
    );
  });
});
