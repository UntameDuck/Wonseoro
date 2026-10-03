import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { ApplicationRepository } from '../application/application.repository';
import { ApplicationStateService } from '../application/application-state.service';
import { ProfileVaultClient } from '../application/profile-vault.client';
import { checkInFlightCompatibility } from './config-compat';

/**
 * 진행 중 원서와의 호환 시험 — 실제 DB 로 (T-M6-02, D-77)
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let db: Db;
let available = false;
let typeCode = '';
const applicants = [randomUUID(), randomUUID()];
const apps: string[] = [];

const repo = () => new ApplicationRepository(db, new AuditService(), new ApplicationStateService(), new ProfileVaultClient(new DependencyBreakers()));
const form = (props: Record<string, unknown>, required: string[] = []) => ({ forms: { [typeCode]: { type: 'object', properties: props, required } } });
const mine = (r: Awaited<ReturnType<typeof checkInFlightCompatibility>>) => r.broken.filter((b) => apps.includes(b.applicationId));

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  typeCode = (await db.query<{ code: string }>(`SELECT code FROM admission_type WHERE id = $1`, [TYPE])).rows[0]?.code ?? '';
  for (const id of applicants) {
    await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'none')`, [id, `subj-compat-${id.slice(0, 8)}`]);
    const { row } = await repo().create({ cycleId: CYCLE, applicantId: id, admissionTypeId: TYPE, departmentId: DEPT });
    await repo().patch({ applicationId: row.id, expectedVersion: BigInt(row.version), fields: { selfIntro: '열 글자를 넘는 자기소개 문장입니다', gpa: 4.1 }, schemaVersion: 'v-compat' });
    apps.push(row.id);
  }
  // 둘째 원서는 검증을 마쳤다(READY) — 새 필수 항목이 생기면 막힌다
  await breakGlass((c) => c.query(`UPDATE kadmission.application SET status = 'READY' WHERE id = $1`, [apps[1]]));
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.audit_event WHERE application_id = ANY($1::uuid[])`, [apps]);
    await c.query(`DELETE FROM kadmission.outbox_event WHERE aggregate_id = ANY($1::uuid[])`, [apps]);
    await c.query(`DELETE FROM kadmission.consent_record WHERE application_id = ANY($1::uuid[])`, [apps]);
    await c.query(`DELETE FROM kadmission.application WHERE id = ANY($1::uuid[])`, [apps]);
    await c.query(`DELETE FROM kadmission.applicant WHERE id = ANY($1::uuid[])`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('진행 중 원서와의 호환 시험 (T-M6-02)', () => {
  it('저장된 값과 맞는 설정은 통과한다 — 작성 중 원서의 빈 필수 항목은 지원자가 채운다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await checkInFlightCompatibility(db, CYCLE, form({ selfIntro: { type: 'string', maxLength: 500 }, gpa: { type: 'number' }, essay: { type: 'string' } }));
    assert.deepEqual(mine(r).map((b) => b.applicationId), [], '두 원서 모두 맞다');
    assert.ok(r.checked >= 2);
  });

  it('최대 글자 수를 줄이면 저장된 값이 어긋난 원서를 모두 찾는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await checkInFlightCompatibility(db, CYCLE, form({ selfIntro: { type: 'string', maxLength: 10 }, gpa: { type: 'number' } }));
    assert.equal(mine(r).length, 2);
    assert.ok(mine(r).every((b) => b.problems.some((p) => p.includes('/selfIntro maxLength'))));
  });

  it('형식을 바꾸면(숫자 → 글자) 어긋난다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await checkInFlightCompatibility(db, CYCLE, form({ selfIntro: { type: 'string' }, gpa: { type: 'string' } }));
    assert.equal(mine(r).length, 2);
  });

  it('필수 항목을 더하면 검증을 마친 원서만 막힌다(작성 중 원서는 채울 수 있다)', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await checkInFlightCompatibility(db, CYCLE, form({ selfIntro: { type: 'string' }, gpa: { type: 'number' }, essay: { type: 'string' } }, ['essay']));
    assert.deepEqual(mine(r).map((b) => `${b.status}:${b.problems.join(',')}`), ['READY:/ required(essay)']);
  });
});
