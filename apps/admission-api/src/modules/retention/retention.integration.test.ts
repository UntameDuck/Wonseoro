import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { ActivationRecorder } from '../activation/activation-recorder';
import { ActivationSigner } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
import { ConfigVersionService } from '../config/config-version.service';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { DeadlineService } from '../deadline/deadline.service';
import { VALID_RETENTION } from './retention.fixture';
import { RetentionService } from './retention.service';

/**
 * 보존정책 → 설정 승인 → 파기 계획 통합 테스트 — 실제 PostgreSQL 이 필요하다. (T-M3-10)
 * 전형은 지우지 않고 닫는다 (적용 기록이 남으므로).
 */
let db: Db;
let available = false;
const cycles: string[] = [];

const recorder = () => new ActivationRecorder(db, new ActivationSigner(), new AuditService());
const configs = () =>
  new ConfigVersionService(
    db,
    new DeadlineService(new DeadlinePolicyRepository(db, recorder())),
    recorder(),
  );

/** 이미 마감된 지 오래된 모집. 보존기간이 지난 상태를 만든다. */
async function makeClosedCycle(closedDaysAgo: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
     VALUES ($1, 'UNIV-A', 2099, $2, now() - ($3 || ' days')::interval - interval '30 days',
             now() - ($3 || ' days')::interval, 'CLOSED')`,
    [id, `보존 검증용 ${id.slice(0, 8)}`, String(closedDaysAgo)],
  );
  cycles.push(id);
  return id;
}

async function activate(cycleId: string, config: Record<string, unknown>): Promise<void> {
  const svc = configs();
  const row = await svc.createDraft({ cycleId, version: `ret-${randomUUID().slice(0, 6)}`, config, createdBy: 'privacy1@univ-a' });
  const d1 = await svc.diff(row.id);
  await svc.approve(row.id, 'privacy2@univ-a', d1.digest);
  const d2 = await svc.diff(row.id);
  await svc.approve(row.id, 'privacy3@univ-a', d2.digest);
  await svc.activate(row.id, null, 'privacy2@univ-a');
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  for (const id of cycles) {
    await db.query(`UPDATE admission_cycle SET status = 'ARCHIVED' WHERE id = $1`, [id]);
  }
  await db.onApplicationShutdown();
});

describe('보존정책은 설정 승인 절차를 탄다 (v1.1 §A15·§A14)', () => {
  it('법정 기준보다 짧은 보존정책은 초안조차 만들 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeClosedCycle(10);
    await assert.rejects(
      configs().createDraft({
        cycleId,
        version: 'ret-bad',
        config: { retention: { ...VALID_RETENTION, ADMIN_ACCESS_LOG: { days: 30 } } },
        createdBy: 'privacy1@univ-a',
      }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        /ADMIN_ACCESS_LOG/.test(String(err.problem.detail)),
    );
  });

  it('보존정책이 없으면 아무것도 파기 대상이 아니다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeClosedCycle(4000);
    await activate(cycleId, { forms: {} });
    const plan = await new RetentionService(db).plan(cycleId);
    assert.equal(plan.configured, false);
    assert.equal(plan.executes, false);
    assert.ok(plan.items.every((i) => i.status === 'UNSET' || i.status === 'IMMUTABLE'));
  });

  it('보존기간이 지난 항목만 파기 대상으로 보이고, 지우지는 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // 마감 400일 경과. 서류 365일은 지났고, 원서 1825일은 남았다.
    const cycleId = await makeClosedCycle(400);
    await activate(cycleId, { retention: VALID_RETENTION });

    const plan = await new RetentionService(db).plan(cycleId);
    const byCode = Object.fromEntries(plan.items.map((i) => [i.code, i]));
    assert.equal(plan.configured, true);
    assert.deepEqual(plan.problems, []);

    assert.equal(byCode.DOCUMENT_FILE!.status, 'DUE');
    assert.equal(byCode.DOCUMENT_FILE!.purge, 'OBJECT');
    assert.equal(byCode.APPLICATION_UNSUBMITTED!.status, 'DUE');
    assert.equal(byCode.APPLICATION_UNSUBMITTED!.purge, 'CONTENT', '행은 지우지 않는다 — 감사 체인이 참조한다');
    assert.equal(byCode.APPLICATION_SUBMITTED!.status, 'RETAINED');
    assert.equal(byCode.APPLICATION_SUBMITTED!.affected, null);
    assert.equal(byCode.AUDIT_EVENT!.status, 'IMMUTABLE');
    assert.equal(byCode.ACTIVATION_RECORD!.status, 'IMMUTABLE');
  });
});
