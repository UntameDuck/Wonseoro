import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { ConsentService } from './consent.service';

/** 원서 동의 — 적용 중 시드 설정의 동의 문안으로 기록·철회·검증 오류·잠금을 실제 DB 에서 본다 (G-2, D-81) */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db: Db;
let available = false;
let applicantId = '';
let applicationId = '';

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  applicantId = randomUUID();
  applicationId = randomUUID();
  await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1,$2,'\\x00','v1')`, [
    applicantId,
    `subj-consent-${applicantId.slice(0, 8)}`,
  ]);
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status) VALUES ($1,$2,$3,$4,$5,'DRAFT')`,
    [applicationId, CYCLE, applicantId, TYPE, DEPT],
  );
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.consent_record WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.application WHERE id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = $1`, [applicantId]);
  });
  await db.onApplicationShutdown();
});

describe('원서 동의 (G-2, D-81)', () => {
  const service = () => new ConsentService(db, new AuditService());

  it('설정의 필수 동의가 없으면 검증 오류가 동의마다 하나씩 나온다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const state = await service().state(applicationId, CYCLE);
    assert.ok(state.length >= 1 && state.every((c) => !c.granted));
    const missing = await service().missingRequired(applicationId, CYCLE);
    assert.equal(missing.length, state.filter((c) => c.required).length);
    assert.ok(missing.every((i) => i.code === 'CONSENT_REQUIRED' && i.path.startsWith('/consents/') && i.message.endsWith('동의해 주십시오.')));
  });

  it('동의하면 판·문안 해시·감사 기록이 남고, 거두면 다시 오류가 된다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const codes = (await service().state(applicationId, CYCLE)).map((c) => c.code);
    const after = await service().record({ applicationId, applicantId, changes: codes.map((code) => ({ code, granted: true })) });
    assert.ok(after.every((c) => c.granted));
    assert.deepEqual(await service().missingRequired(applicationId, CYCLE), []);
    const rows = await db.query<{ evidence_hash: string; policy_version: string }>(
      `SELECT evidence_hash, policy_version FROM consent_record WHERE application_id = $1`,
      [applicationId],
    );
    assert.equal(rows.rows.length, codes.length);
    assert.ok(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.evidence_hash)));
    const audit = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_event WHERE application_id = $1 AND action = 'CONSENT_RECORDED'`,
      [applicationId],
    );
    assert.equal(Number(audit.rows[0]!.n), codes.length);

    await service().record({ applicationId, applicantId, changes: [{ code: codes[0]!, granted: false }] });
    assert.equal((await service().missingRequired(applicationId, CYCLE)).length, 1);
  });

  it('지금 판에 없는 코드는 400, 결제를 시작한 원서는 409', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(
      service().record({ applicationId, applicantId, changes: [{ code: 'NOT_IN_CONFIG', granted: true }] }),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 400,
    );
    await breakGlass((c) => c.query(`UPDATE kadmission.application SET status = 'PAYMENT_PENDING' WHERE id = $1`, [applicationId]));
    const code = (await service().state(applicationId, CYCLE))[0]!.code;
    await assert.rejects(
      service().record({ applicationId, applicantId, changes: [{ code, granted: true }] }),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 409,
    );
  });
});
