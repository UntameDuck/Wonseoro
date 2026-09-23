import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { DeadlineService } from '../deadline/deadline.service';
import { ConfigVersionService } from './config-version.service';

/**
 * Configuration Governance 통합 테스트 — 실제 PostgreSQL 이 필요하다. (T-M3-02)
 *
 * **공용 개발 설정을 건드리지 않는다.**
 * 전에 통합 테스트가 개발 Config 를 바꿔 실행 중인 화면을 망가뜨린 적이 있다.
 * 그래서 이 파일은 전용 전형(cycle)을 따로 만들고 끝나면 지운다.
 */
let db: Db;
let available = false;
/** 테스트마다 전용 전형을 쓴다. 같은 전형의 ACTIVE 를 둘이 동시에 건드리면 서로를 깨뜨린다. */
const cycles: string[] = [];
let cycleId: string;

async function makeCycle(name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
     VALUES ($1, 'UNIV-A', 2099, $2, now(), now() + interval '90 days', 'OPEN')`,
    [id, name],
  );
  cycles.push(id);
  return id;
}

function service(): ConfigVersionService {
  const policies = new DeadlinePolicyRepository(db);
  return new ConfigVersionService(db, new DeadlineService(policies));
}

async function draft(
  version: string,
  config: Record<string, unknown>,
  cycle = cycleId,
  createdBy = 'admin1@univ-a',
): Promise<string> {
  const row = await service().createDraft({ cycleId: cycle, version, config, createdBy });
  return row.id;
}

/** 첫 설정을 적용해 둔다. 이후 변경의 기준이 된다. */
async function seedActive(cycle: string, version: string): Promise<string> {
  const id = await draft(version, BASE, cycle);
  await approveTwice(id);
  await service().activate(id, null);
  return id;
}

/** 승인 두 명을 받는다. 매번 현재 Diff 를 확인한 것으로 처리한다. */
async function approveTwice(configId: string): Promise<void> {
  const svc = service();
  const first = await svc.diff(configId);
  await svc.approve(configId, 'admin2@univ-a', first.digest);
  const second = await svc.diff(configId);
  await svc.approve(configId, 'admin3@univ-a', second.digest);
}

async function problemStatus(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const problem = (err as { problem?: { status: number } }).problem;
    // 업무 오류가 아닌 것을 undefined 로 삼키면 "안 던졌다" 와 구분되지 않는다.
    // 원인을 찾는 데 한참 걸린다. 그냥 올려보낸다.
    if (!problem) throw err;
    return problem.status;
  }
}

const BASE = {
  forms: {
    EARLY: {
      type: 'object',
      required: ['highSchool'],
      properties: { highSchool: { type: 'string', minLength: 2, maxLength: 100 } },
    },
  },
  fees: { EARLY: 55000 },
};

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  cycleId = await makeCycle('거버넌스 검증용');
  await seedActive(cycleId, 'gov-v1');
});

after(async () => {
  if (!available) return;
  for (const id of cycles) {
    await db.query(`DELETE FROM config_version WHERE cycle_id = $1`, [id]);
    await db.query(`DELETE FROM deadline_policy WHERE cycle_id = $1`, [id]);
    await db.query(`DELETE FROM admission_cycle WHERE id = $1`, [id]);
  }
  await db.onApplicationShutdown();
});

describe('Diff 를 확인해야 승인할 수 있다 (v1.1 §A14)', () => {
  it('Diff digest 없이는 승인할 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await draft('gov-nodigest', { ...BASE, fees: { EARLY: 60000 } });
    assert.equal(await problemStatus(service().approve(id, 'admin2@univ-a', '')), 400);
  });

  it('본 뒤에 내용이 바뀌면 승인이 거부된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await draft('gov-stale', { ...BASE, fees: { EARLY: 60000 } });
    const seen = await service().diff(id);

    // 승인자가 화면을 본 사이에 초안이 바뀌었다.
    await db.query(
      `UPDATE config_version SET config_json = $2 WHERE id = $1`,
      [id, JSON.stringify({ ...BASE, fees: { EARLY: 99000 } })],
    );

    // 같은 승인이 다른 의미가 된다. 다시 보게 해야 한다.
    assert.equal(await problemStatus(service().approve(id, 'admin2@univ-a', seen.digest)), 409);
  });

  it('바뀌는 내용이 없는 설정은 승인하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await draft('gov-same', BASE);
    const d = await service().diff(id);
    assert.equal(d.identical, true);
    assert.equal(await problemStatus(service().approve(id, 'admin2@univ-a', d.digest)), 400);
  });

  it('빈 설정은 파괴적 변경으로 드러난다 — 실제로 겪은 사고다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await draft('gov-empty', { forms: {}, fees: {} });
    const d = await service().diff(id);

    // 전에는 이 설정이 아무 경고 없이 승인·활성화돼 모든 양식이 사라졌다.
    assert.ok(d.destructive.length > 0, '승인 화면이 이것을 위험하다고 말해야 한다');
    assert.ok(d.destructive.some((c) => c.path === 'forms.EARLY'));
  });
});

describe('되돌리기 (Rollback)', () => {
  it('적용된 적 없는 설정으로는 되돌릴 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await draft('gov-never', { ...BASE, fees: { EARLY: 70000 } }, cycleId);
    // 활성화된 적 없는 초안으로 가는 것은 되돌리기가 아니라 새 변경이다.
    assert.equal(
      await problemStatus(
        service().rollback({ targetConfigId: id, operator: 'admin9@univ-a', reason: '복구' }),
      ),
      400,
    );
  });

  it('사유 없이는 되돌릴 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [cycleId],
    );
    assert.equal(
      await problemStatus(
        service().rollback({
          targetConfigId: String(rows[0]?.id),
          operator: 'admin9@univ-a',
          reason: ' ',
        }),
      ),
      400,
    );
  });

  it('전에 적용된 설정으로 되돌리면 그 행이 다시 ACTIVE 가 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const svc = service();

    // 이 테스트는 ACTIVE 를 바꾼다. 전용 전형에서 돌린다.
    const cyc = await makeCycle('되돌리기 검증용');
    const originalId = await seedActive(cyc, 'rb-v1');

    // 전형료를 올린 새 설정을 정상 절차로 적용한다.
    const next = await draft('rb-v2', { ...BASE, fees: { EARLY: 66000 } }, cyc);
    await approveTwice(next);
    await svc.activate(next, null);
    assert.equal((await svc.active(cyc))?.id, next);

    // 잘못됐다는 것을 알았다. 되돌린다.
    const result = await svc.rollback({
      targetConfigId: originalId,
      operator: 'admin9@univ-a',
      reason: '전형료가 공고와 다릅니다.',
    });

    assert.equal(result.restored.id, originalId);
    assert.equal(result.restored.status, 'ACTIVE');
    assert.equal(result.retired, 'rb-v2');

    // 새 버전을 만들지 않는다. 승인자를 지어내지 않기 위해서다.
    assert.deepEqual(result.restored.approvedBy, ['admin2@univ-a', 'admin3@univ-a']);

    // 활성 설정은 여전히 하나다.
    const actives = await db.query(
      `SELECT 1 FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [cyc],
    );
    assert.equal(actives.rowCount, 1);
  });
});

describe('마감 임박 잠금 (Freeze)', () => {
  /**
   * 잠금의 두 면을 한 테스트에서 본다.
   *   막는 것  — 마감 직전의 새 설정 활성화
   *   안 막는 것 — 되돌리기
   *
   * 둘을 나누면 같은 전형의 ACTIVE 를 두 테스트가 동시에 건드리게 되고,
   * 그러면 서로를 깨뜨린다. 하나의 규칙이니 하나의 테스트로 둔다.
   */
  it('새 설정은 막고 되돌리기는 막지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');

    const cyc = await makeCycle('잠금 검증용');
    const firstId = await seedActive(cyc, 'fz-v1');

    // 잠금 전에 두 번째 설정을 정상 적용해 둔다. 되돌릴 대상이 필요하다.
    const secondId = await draft('fz-v2', { ...BASE, fees: { EARLY: 66000 } }, cyc);
    await approveTwice(secondId);
    await service().activate(secondId, null);

    // 이제 마감을 1시간 뒤로 둔다. 잠금 구간(기본 24시간)에 들어간다.
    const policies = new DeadlinePolicyRepository(db);
    const { policyId } = await policies.createDraft({
      cycleId: cyc,
      version: 'fz-pol-1',
      mode: 'FINALIZED_COMMIT_BEFORE_DEADLINE',
      deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdBy: 'admin1@univ-a',
    });
    await policies.approve(policyId, 'admin2@univ-a');
    await policies.approve(policyId, 'admin3@univ-a');
    await policies.activate(policyId, null);

    // 새 변경은 막힌다. 마지막 몇 시간의 설정 변경은 검증할 시간이 없다.
    const thirdId = await draft('fz-v3', { ...BASE, fees: { EARLY: 77000 } }, cyc);
    await approveTwice(thirdId);
    assert.equal(await problemStatus(service().activate(thirdId, null)), 403);

    // 되돌리기는 막히지 않는다.
    // Freeze 는 새 변경을 멈추는 장치다. 잘못된 설정으로 마감을 맞는 쪽이 더 큰 사고다.
    const result = await service().rollback({
      targetConfigId: firstId,
      operator: 'admin9@univ-a',
      reason: '마감 직전 복구',
    });
    assert.equal(result.restored.id, firstId);
    assert.equal(result.retired, 'fz-v2');
  });
});
