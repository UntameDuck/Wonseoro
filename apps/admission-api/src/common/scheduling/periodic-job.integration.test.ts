import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { breakGlass } from '../../test-support/break-glass';
import { isJobDue, jobKey, lastJobSuccess, recordJobSuccess, runIfDue, type PeriodicJob } from './periodic-job';

/**
 * 주기 작업의 때·마지막 성공을 DB 로 (D-93) — 실 DB 가 없으면 건너뛴다.
 * 시험마다 새 작업 이름을 쓴다(다른 시험·실제 스케줄러와 겹치지 않게).
 */
let db: Db;
let available = false;
const run = randomUUID().slice(0, 8);
const job = (name: string, intervalMs = 3_600_000): PeriodicJob => ({ name: `test-${name}-${run}`, university: 'UNIV-T', intervalMs });
const made: PeriodicJob[] = [];

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  await breakGlass((c) => c.query(`DELETE FROM scheduled_job_run WHERE job = ANY($1)`, [made.map(jobKey)]));
  await db.onApplicationShutdown();
});

describe('주기 작업의 때를 DB 로 정한다 (D-93)', () => {
  it('기록이 없으면 바로 돌고, 주기 안이면 다시 뜬 프로세스라도 돌지 않는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const j = job('due');
    made.push(j);
    let calls = 0;
    const first = await runIfDue(db, j, `test:${j.name}`, async () => ++calls, (n) => ({ n }));
    assert.equal(first, 1);
    const last = await lastJobSuccess(db, j);
    assert.ok(last !== null && Math.abs(last - Date.now()) < 60_000);
    // 같은 작업을 다른 프로세스가 다시 불러도(재시작) 주기 안이면 안 돈다
    assert.equal(await runIfDue(db, j, `test:${j.name}`, async () => ++calls), null);
    assert.equal(calls, 1);
    // 주기가 지난 것으로 보면 때다
    assert.equal(await isJobDue(db, j, Date.now() + 2 * j.intervalMs), true);
    const { rows } = await db.query<{ result: { n: number } }>(`SELECT result FROM scheduled_job_run WHERE job = $1`, [jobKey(j)]);
    assert.deepEqual(rows[0]?.result, { n: 1 });
  });

  it('작업이 실패하면 성공을 남기지 않는다 — 다음 확인에 다시 돈다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const j = job('fail');
    made.push(j);
    await assert.rejects(runIfDue(db, j, `test:${j.name}`, async () => {
      throw new Error('작업 실패');
    }));
    assert.equal(await lastJobSuccess(db, j), null);
    assert.equal(await isJobDue(db, j), true);
  });

  it('앞날 기록은 믿지 않는다 — 바로 돌고 지금으로 덮어쓴다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const j = job('future');
    made.push(j);
    await recordJobSuccess(db, j);
    await breakGlass((c) => c.query(`UPDATE scheduled_job_run SET last_success_at = now() + interval '1 day' WHERE job = $1`, [jobKey(j)]));
    assert.equal(await lastJobSuccess(db, j), null);
    assert.equal(await runIfDue(db, j, `test:${j.name}`, async () => 'ran'), 'ran');
    const last = await lastJobSuccess(db, j);
    assert.ok(last !== null && Math.abs(last - Date.now()) < 60_000);
  });

  it('다른 Pod 가 잠금을 쥐고 있으면 돌지 않는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const j = job('lock');
    made.push(j);
    let inner: string | null = 'not-run';
    const outer = await runIfDue(db, j, `test:${j.name}`, async () => {
      // 같은 잠금을 다른 연결이 잡으려 하면(두 번째 Pod) 못 잡는다
      inner = await runIfDue(db, { ...j, intervalMs: 1 }, `test:${j.name}`, async () => 'second');
      return 'first';
    });
    assert.equal(outer, 'first');
    assert.equal(inner, null);
  });
});
