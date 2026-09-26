import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { after, before, describe, it } from 'node:test';
import { Db, purposeRef } from '@wonseoro/server-kit';
import type { DashboardController as Controller } from './dashboard.controller';

/**
 * "내 원서" 조회 — 목적별 지원자 참조 (v1.1 §A12, T-M3-09) — 실제 중앙 PostgreSQL 이 필요하다.
 *
 * 키를 교체하는 중인 상황을 만든다. 현재 키 k2, 옛 키 k1.
 */
// 설정은 import 시점에 확정된다. 불러오기 전에 정한다.
process.env.SUBJECT_REF_KEYS = 'k2=new-dashboard-key,k1=old-dashboard-key';

const UNIV = 'UNIV-DASH';
const token = `subj-dash-${randomUUID().slice(0, 8)}`;
let db: Db;
let available = false;
let controller: Controller;

async function summary(appId: string, subjectRef: string): Promise<void> {
  await db.query(
    `INSERT INTO application_summary
       (university_id, application_id, admission_year, admission_type_code, department_code,
        status, application_number, last_sequence, subject_ref)
     VALUES ($1,$2,2027,'EARLY','CSE','FINALIZED',$3,1,$4)`,
    [UNIV, appId, `2027-${appId}`, subjectRef],
  );
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('central-api', 'kadmission_central');
  available = await db.healthy();
  if (!available) return;
  await db.query(
    `INSERT INTO university_registry (id, name, status)
     VALUES ($1, '대시보드 검증대학', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [UNIV],
  );
  const { DashboardController } = await import('./dashboard.controller');
  controller = new DashboardController(db);

  // 새 키로 옮긴 대학, 아직 옛 키를 쓰는 대학, 그리고 전의 무키 해시.
  await summary('A-NEW', purposeRef('DASHBOARD', { id: 'k2', secret: 'new-dashboard-key' }, token));
  await summary('B-OLD', purposeRef('DASHBOARD', { id: 'k1', secret: 'old-dashboard-key' }, token));
  await summary('C-NAIVE', createHash('sha256').update(token).digest('hex'));
  // 다른 사람.
  await summary('D-OTHER', purposeRef('DASHBOARD', { id: 'k2', secret: 'new-dashboard-key' }, `${token}-x`));
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM application_summary WHERE university_id = $1`, [UNIV]);
  await db.query(`DELETE FROM university_registry WHERE id = $1`, [UNIV]);
  await db.onApplicationShutdown();
});

describe('"내 원서" 조회 — 목적별 지원자 참조 (v1.1 §A12)', () => {
  it('키를 교체하는 동안 새 키·옛 키로 만든 참조가 모두 찾아진다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const res = await controller.list(token, undefined);
    const ids = res.applications.map((a) => a.applicationNumber).sort();
    assert.deepEqual(ids, ['2027-A-NEW', '2027-B-OLD']);
  });

  it('키 없는 해시로 만든 참조는 찾아지지 않는다 — Vault 토큰으로 다시 만들 수 있었던 값이다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const res = await controller.list(token, undefined);
    assert.ok(!res.applications.some((a) => a.applicationNumber === '2027-C-NAIVE'));
  });

  it('식별자를 URL 에 실으면 거절한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await assert.rejects(
      controller.list(undefined, token),
      (err: unknown) => err instanceof HttpException && err.getStatus() === 400,
    );
  });
});
