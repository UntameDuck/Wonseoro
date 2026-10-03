import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService } from '../audit/audit.service';
import { IncidentService } from './incident.service';

/** 대학별 장애 공지의 발행 → 공개 → 해제와 불변 원장을 실제 PostgreSQL 로 확인한다. (T-M6-06, D-78) */
let db: Db;
let available = false;
let incidentId = '';

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  if (incidentId) {
    await breakGlass((client) =>
      client.query(`DELETE FROM kadmission.service_incident WHERE id = $1`, [incidentId]),
    );
  }
  await db.onApplicationShutdown();
});

describe('대학별 장애 공지 원장 (T-M6-06, D-78)', () => {
  it('발행한 공지가 공개 상태를 올리고 담당자·감사 기록을 남긴다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const service = new IncidentService(db, new AuditService());
    const published = await service.publish({
      severity: 'DEGRADED',
      title: '서류 확인이 지연되고 있습니다',
      message: '원서는 계속 작성할 수 있습니다. 올린 서류의 확인 결과가 늦게 표시될 수 있습니다.',
      operator: 'ops-incident-test',
    });
    incidentId = published.id;
    assert.equal(published.status, 'ACTIVE');
    assert.equal(published.createdBy, 'ops-incident-test');

    const publicView = await service.publicStatus();
    assert.equal(publicView.status, 'DEGRADED');
    assert.equal(publicView.incidents.some((item) => item.id === incidentId), true);
    assert.equal('createdBy' in publicView.incidents[0]!, false, '공개 응답에 담당자를 싣지 않는다');

    const audit = await db.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_event
        WHERE application_id IS NULL AND details_redacted->>'incidentId' = $1
        ORDER BY occurred_at`,
      [incidentId],
    );
    assert.deepEqual(audit.rows, [{ action: 'INCIDENT_PUBLISHED', actor_id: 'ops-incident-test' }]);
  });

  it('본문은 덮어쓸 수 없고 해제만 한 번 가능하다', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(
      db.query(`UPDATE service_incident SET title = '바꾼 제목' WHERE id = $1`, [incidentId]),
      /해제만 가능하다/,
    );

    const service = new IncidentService(db, new AuditService());
    const resolved = await service.resolve(incidentId, 'ops-resolver-test');
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.resolvedBy, 'ops-resolver-test');
    const publicView = await service.publicStatus();
    assert.equal(publicView.incidents.some((item) => item.id === incidentId), false);

    const audit = await db.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_event
        WHERE application_id IS NULL AND details_redacted->>'incidentId' = $1
        ORDER BY occurred_at`,
      [incidentId],
    );
    assert.deepEqual(audit.rows, [
      { action: 'INCIDENT_PUBLISHED', actor_id: 'ops-incident-test' },
      { action: 'INCIDENT_RESOLVED', actor_id: 'ops-resolver-test' },
    ]);
    await assert.rejects(
      service.resolve(incidentId, 'ops-resolver-test'),
      (error: unknown) =>
        error instanceof ProblemException &&
        error.getStatus() === 404 &&
        /활성 장애 공지를 찾을 수 없습니다/.test(String(error.problem.detail)),
    );
  });
});
