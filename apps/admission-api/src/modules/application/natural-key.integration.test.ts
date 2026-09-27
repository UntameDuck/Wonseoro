import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { ApplicationRepository } from './application.repository';
import { ApplicationStateService } from './application-state.service';
import { ProfileVaultClient } from './profile-vault.client';

/**
 * 원서 자연키 — 한 전형에는 모집단위 하나 (D-29, 0005)
 *
 * 대학입학전형기본사항 — "원서접수 시, 하나의 전형에서는 하나의 모집단위에만 지원할 수 있음".
 * 취소한 원서는 키에서 빠진다 — 결제 전 삭제·재작성은 현행 원서접수의 관행이다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
let applicantId: string;
const otherDept = randomUUID();
const otherType = randomUUID();

const repo = () =>
  new ApplicationRepository(
    db,
    new AuditService(),
    new ApplicationStateService(),
    new ProfileVaultClient(new DependencyBreakers()),
  );

const isOnePerType = (err: unknown) =>
  err instanceof ProblemException &&
  err.getStatus() === 409 &&
  err.problem.code === 'ONE_DEPARTMENT_PER_ADMISSION_TYPE';

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  applicantId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-${applicantId.slice(0, 8)}`],
  );
  await breakGlass(async (c) => {
    await c.query(
      `INSERT INTO department (id, cycle_id, code, name, quota) VALUES ($1,$2,$3,'자연키 검증 학과',10)`,
      [otherDept, CYCLE, `NK-${otherDept.slice(0, 6)}`],
    );
    await c.query(
      `INSERT INTO admission_type (id, cycle_id, code, name, fee_amount) VALUES ($1,$2,$3,'자연키 검증 전형',0)`,
      [otherType, CYCLE, `NK-${otherType.slice(0, 6)}`],
    );
  });
});

after(async () => {
  if (!available) return;
  // 감사 기록은 앱 역할로 지울 수 없다 (D-41). 시험 정리만 이 경로를 쓴다.
  await breakGlass(async (c) => {
    const apps = `(SELECT id FROM application WHERE applicant_id = $1)`;
    await c.query(`DELETE FROM audit_event WHERE application_id IN ${apps}`, [applicantId]);
    await c.query(`DELETE FROM outbox_event WHERE aggregate_id IN ${apps}`, [applicantId]);
    await c.query(`DELETE FROM application_field_value WHERE application_id IN ${apps}`, [applicantId]);
    await c.query(`DELETE FROM consent_record WHERE application_id IN ${apps}`, [applicantId]);
    await c.query(`DELETE FROM application WHERE applicant_id = $1`, [applicantId]);
    await c.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    await c.query(`DELETE FROM department WHERE id = $1`, [otherDept]);
    await c.query(`DELETE FROM admission_type WHERE id = $1`, [otherType]);
  });
  await db.onApplicationShutdown();
});

describe('한 전형에는 모집단위 하나 (D-29)', () => {
  let first: string;

  it('같은 전형·모집단위 재시도는 기존 원서를 돌려준다 — 오류가 아니다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const input = { cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: DEPT };
    const a = await repo().create(input);
    const b = await repo().create(input);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.row.id, a.row.id);
    first = a.row.id;
  });

  it('같은 전형의 다른 모집단위는 409 — 기존 원서를 조용히 돌려주지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await assert.rejects(
      repo().create({ cycleId: CYCLE, applicantId, admissionTypeId: TYPE, departmentId: otherDept }),
      isOnePerType,
    );
  });

  it('다른 전형으로 옮기려는데 그 전형에 유효한 원서가 있으면 409 — 500 이 아니다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const other = await repo().create({
      cycleId: CYCLE,
      applicantId,
      admissionTypeId: otherType,
      departmentId: DEPT,
    });
    await assert.rejects(
      repo().patch({
        applicationId: other.row.id,
        expectedVersion: BigInt(other.row.version),
        admissionTypeId: TYPE,
        schemaVersion: 'nk-test',
      }),
      isOnePerType,
    );
  });

  it('취소한 뒤에는 같은 전형의 다른 모집단위로 다시 지원할 수 있다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await db.query(`UPDATE application SET status = 'CANCELLED' WHERE id = $1`, [first]);
    const again = await repo().create({
      cycleId: CYCLE,
      applicantId,
      admissionTypeId: TYPE,
      departmentId: otherDept,
    });
    assert.equal(again.created, true);
    assert.notEqual(again.row.id, first);
    assert.equal(again.row.departmentId, otherDept);
  });
});
