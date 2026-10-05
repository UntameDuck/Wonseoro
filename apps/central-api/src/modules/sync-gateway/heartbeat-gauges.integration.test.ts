import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { HeartbeatGauges } from './heartbeat-gauges';

/** 대학별 심장박동 나이 지표 (D-93) — 실 중앙 DB 가 없으면 건너뛴다 */
let db: Db;
let available = false;
const quiet = `HB-${randomUUID().slice(0, 6)}`;
const never = `HB-${randomUUID().slice(0, 6)}`;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('central-api', 'kadmission_central');
  if (!(await db.healthy())) return;
  available = true;
  await db.query(`INSERT INTO university_registry (id, name, status) VALUES ($1, '조용한 대학', 'ACTIVE'), ($2, '아직 안 온 대학', 'ACTIVE')`, [quiet, never]);
  await db.query(`INSERT INTO university_sync_state (university_id, last_heartbeat_at) VALUES ($1, now() - interval '10 minutes')`, [quiet]);
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM university_sync_state WHERE university_id = ANY($1)`, [[quiet, never]]);
  await db.query(`DELETE FROM university_registry WHERE id = ANY($1)`, [[quiet, never]]);
  await db.onApplicationShutdown();
});

describe('대학별 심장박동 나이 (D-93)', () => {
  it('활성 대학의 마지막 심장박동 뒤 지난 시간을 낸다 — 한 번도 받지 못한 대학은 내지 않는다', async (t) => {
    if (!available) return t.skip('중앙 DB 없음');
    const ages = await new HeartbeatGauges(db).refresh();
    assert.ok(ages);
    const q = ages.find((a) => a.university === quiet);
    assert.ok(q && q.age >= 590 && q.age <= 660, `조용한 대학 ${JSON.stringify(q)}`);
    assert.equal(ages.find((a) => a.university === never), undefined);
  });
});
