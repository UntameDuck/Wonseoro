import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@wonseoro/server-kit';
import type { Queryable } from '../db/queryable';
import { checkEveryMs, isJobDue, recordJobSuccess, registerPeriodicJob } from './periodic-job';

/** 0012(scheduled_job_run)를 아직 적용하지 않은 DB — 작업이 아예 멈추지 않고 예전처럼 돈다 (D-93) */
const missingTable = Object.assign(new Error('relation "scheduled_job_run" does not exist'), { code: '42P01' });
const job = { name: 'test-missing', university: 'UNIV-T', intervalMs: 3_600_000 };

describe('주기 작업 — 표가 없는 DB (D-93)', () => {
  it('때 확인은 이 프로세스의 마지막 성공으로 — 처음엔 돌고, 끝낸 뒤 주기 안에는 다시 돌지 않는다', async () => {
    const db = { query: async () => Promise.reject(missingTable) } as unknown as Queryable;
    const registered = { ...job, name: 'test-missing-registered' };
    registerPeriodicJob(registered);
    assert.equal(await isJobDue(db, registered), true, '아직 끝낸 적 없음');
    await recordJobSuccess({ tx: async () => Promise.reject(missingTable) } as unknown as Db, registered);
    assert.equal(await isJobDue(db, registered), false, '주기(1시간) 안 — 타이머(5분)마다 돌지 않는다');
    assert.equal(await isJobDue(db, registered, Date.now() + 2 * registered.intervalMs), true, '주기가 지나면');
  });

  it('성공 기록은 건너뛰고 실패로 만들지 않는다', async () => {
    const db = { tx: async () => Promise.reject(missingTable) } as unknown as Db;
    await recordJobSuccess(db, job, { n: 1 });
  });

  it('다른 DB 오류는 그대로 던진다(조용히 넘기지 않는다)', async () => {
    const other = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    await assert.rejects(isJobDue({ query: async () => Promise.reject(other) } as unknown as Queryable, job), /connection reset/);
    await assert.rejects(recordJobSuccess({ tx: async () => Promise.reject(other) } as unknown as Db, job), /connection reset/);
  });

  it('타이머는 주기와 5분 중 짧은 쪽', () => {
    assert.equal(checkEveryMs(30_000), 30_000);
    assert.equal(checkEveryMs(86_400_000), 300_000);
  });
});
