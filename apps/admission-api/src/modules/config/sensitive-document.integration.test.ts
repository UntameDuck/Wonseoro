import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { DocumentService } from '../document/document.service';
import { FileInspector } from '../document/file-inspector';
import type { ObjectStorage } from '../document/object-storage';
import { ConsentService } from './consent.service';
import { FormSchemaService } from './form-schema.service';

/**
 * 민감정보 서류 별도 동의 (보호법 제23조, 문서 10 G-8, 대장 D-85) — 실제 PostgreSQL, 개발 시드 설정.
 *
 * 시드 학생부종합전형은 장애인 증명서(선택, DISABILITY_CERT)를 「민감정보(장애·건강) 처리」(SENSITIVE_HEALTH, 필수 아님)
 * 별도 동의 뒤에만 받는다. 동의 전 업로드 거절, 동의 뒤 업로드, 서류가 있는 동안 동의를 거두면 접수 검증 오류,
 * 서류를 지우면 오류가 사라지는지, 별도 동의가 없는 서류는 그대로인지를 본다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
let seeded = false;
let applicantId = '';
let applicationId = '';

/** 서명 URL 발급만 흉내 낸다 — 이 시험은 업로드 전 확인을 본다 */
const storage = { presignUpload: async () => ({ url: 'https://storage.test/upload', method: 'PUT', headers: {}, expiresAt: new Date().toISOString() }) } as unknown as ObjectStorage;

function services() {
  const audit = new AuditService();
  const consents = new ConsentService(db, audit);
  return { consents, documents: new DocumentService(db, storage, new FileInspector(), audit, new FormSchemaService(db), consents) };
}

const intent = (documentType: string) =>
  services().documents.createIntent({ applicationId, applicantId, documentType, filename: 'cert.pdf', mediaType: 'application/pdf', sizeBytes: 1024 });

const issuePaths = async () => (await services().consents.missingRequired(applicationId, CYCLE)).map((i) => i.path);

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT config_json->'sensitiveDocuments' ? 'DISABILITY_CERT' AS ok FROM config_version
      WHERE cycle_id = $1 AND status = 'ACTIVE' ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
    [CYCLE],
  );
  seeded = rows[0]?.ok === true;
  applicantId = randomUUID();
  applicationId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-sensitive-${applicantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status) VALUES ($1,$2,$3,$4,$5,'DRAFT')`,
    [applicationId, CYCLE, applicantId, TYPE, DEPT],
  );
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.document WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.consent_record WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.application WHERE id = $1`, [applicationId]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = $1`, [applicantId]);
  });
  await db.onApplicationShutdown();
});

describe('민감정보 서류 별도 동의 (G-8, D-85)', () => {
  it('형식 조회의 서류 목록이 별도 동의 코드를 싣고, 그 동의는 필수가 아니다', async (t) => {
    if (!available) return t.skip('DB 없음');
    if (!seeded) return t.skip('개발 시드가 옛 판 — seed-dev.sql 을 다시 적용한다');
    const { documents } = await new FormSchemaService(db).load(CYCLE, 'EARLY');
    assert.deepEqual(documents.find((d) => d.documentType === 'DISABILITY_CERT')?.sensitiveConsentCode, 'SENSITIVE_HEALTH');
    assert.equal(documents.find((d) => d.documentType === 'TRANSCRIPT')?.sensitiveConsentCode, undefined);
    const health = (await services().consents.active(CYCLE)).find((c) => c.code === 'SENSITIVE_HEALTH');
    assert.equal(health?.required, false);
    assert.deepEqual(await issuePaths(), ['/consents/APPLICATION_COLLECTION', '/consents/SCHOOL_RECORD_PROVISION'], '서류가 없으면 별도 동의를 묻지 않는다');
  });

  it('동의 전에는 민감정보 서류를 올릴 수 없고, 다른 서류는 그대로 올린다', async (t) => {
    if (!available || !seeded) return t.skip('DB 또는 시드 없음');
    await assert.rejects(
      intent('DISABILITY_CERT'),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 400 && /별도 동의/.test(String(e.problem.detail)),
    );
    const { rows } = await db.query(`SELECT 1 FROM document WHERE application_id = $1 AND document_type = 'DISABILITY_CERT'`, [applicationId]);
    assert.equal(rows.length, 0, '거절한 요청은 서류 행을 남기지 않는다');
    const ok = await intent('TRANSCRIPT');
    assert.ok(ok.documentId);
  });

  it('동의하면 올릴 수 있고, 서류가 있는 동안 동의를 거두면 접수 검증이 그 동의를 요구한다', async (t) => {
    if (!available || !seeded) return t.skip('DB 또는 시드 없음');
    const { consents } = services();
    await consents.record({ applicationId, applicantId, changes: [{ code: 'SENSITIVE_HEALTH', granted: true }] });
    const cert = await intent('DISABILITY_CERT');
    assert.ok(cert.documentId);
    assert.equal((await issuePaths()).includes('/consents/SENSITIVE_HEALTH'), false);

    await consents.record({ applicationId, applicantId, changes: [{ code: 'SENSITIVE_HEALTH', granted: false }] });
    const issues = await consents.missingRequired(applicationId, CYCLE);
    const health = issues.find((i) => i.path === '/consents/SENSITIVE_HEALTH');
    assert.ok(health, '거둔 뒤에는 오류');
    assert.match(health.message, /장애인 증명서\(해당자\) 서류를 지워/);

    // 서류를 지우면(삭제 상태) 더는 묻지 않는다
    await db.query(`UPDATE document SET status = 'DELETED' WHERE id = $1`, [cert.documentId]);
    assert.equal((await issuePaths()).includes('/consents/SENSITIVE_HEALTH'), false);
  });
});

describe('항목 단위 별도 동의 — 여권번호 (G-9, D-88)', () => {
  it('동의 전에는 값을 저장하지 않고(빈 값은 된다), 값이 있는데 동의를 거두면 접수 검증이 요구한다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const { schema } = await new FormSchemaService(db).load(CYCLE, 'EARLY');
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    if (props.passportNumber?.['x-sensitive-consent'] !== 'PASSPORT_COLLECTION') return t.skip('개발 시드가 옛 판 — seed-dev.sql 을 다시 적용한다');
    const { consents } = services();
    await assert.rejects(
      consents.assertSensitiveFields(applicationId, CYCLE, schema, { passportNumber: 'M12345678' }),
      (e: unknown) => e instanceof ProblemException && e.getStatus() === 400 && /별도 동의/.test(String(e.problem.detail)),
    );
    await consents.assertSensitiveFields(applicationId, CYCLE, schema, { passportNumber: '', gpa: 4.1 });

    await consents.record({ applicationId, applicantId, changes: [{ code: 'PASSPORT_COLLECTION', granted: true }] });
    await consents.assertSensitiveFields(applicationId, CYCLE, schema, { passportNumber: 'M12345678' });
    await db.query(
      `INSERT INTO application_field_value (id, application_id, field_code, schema_version, value_json) VALUES ($1,$2,'passportNumber','cfg-2027-v1','"M12345678"'::jsonb)`,
      [randomUUID(), applicationId],
    );
    assert.equal((await issuePaths()).includes('/consents/PASSPORT_COLLECTION'), false);

    await consents.record({ applicationId, applicantId, changes: [{ code: 'PASSPORT_COLLECTION', granted: false }] });
    assert.equal((await issuePaths()).includes('/consents/PASSPORT_COLLECTION'), true);
  });
});

describe('지원 제한 고지 확인 (G-12, D-86)', () => {
  it('원서 작성 전 확인은 그때 문안의 해시와 함께 원서 감사 체인에 남는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const { rows } = await db.query<{ rules: string | null }>(
      `SELECT config_json->'notices'->>'applicationRules' AS rules FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE' ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
      [CYCLE],
    );
    if (!rows[0]?.rules) return t.skip('개발 시드가 옛 판 — seed-dev.sql 을 다시 적용한다');
    const recorded = await services().consents.acknowledgeRules({ applicationId, applicantId, cycleId: CYCLE });
    assert.equal(recorded, true);
    const audit = await db.query<{ action: string; hash: string }>(
      `SELECT action, details_redacted->>'textHash' AS hash FROM audit_event WHERE application_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [applicationId],
    );
    assert.equal(audit.rows[0]?.action, 'APPLICATION_RULES_ACKNOWLEDGED');
    const { createHash } = await import('node:crypto');
    assert.equal(audit.rows[0]?.hash, createHash('sha256').update(rows[0].rules.trim()).digest('hex'));
  });
});
