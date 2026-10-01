import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { serverClock } from '../../common/time/server-clock';
import { breakGlass } from '../../test-support/break-glass';
import { AuditService, GENESIS_HASH } from './audit.service';

/**
 * 원서별 감사 체인 회귀 시험 (D-62).
 *
 * 화면 캡처 환경에서 정상 흐름으로 접수한 원서의 증적이 "감사 체인이 끊겨 있습니다" 를 보였다.
 * 변조가 없는데 끊김으로 나오는 길이 둘이다.
 *   ① 시계 offset 이 측정마다 통째로 바뀌어(D-61) 이어 쓰는 기록의 시각이 거꾸로 간다 —
 *      다음 기록의 앞 해시 조회와 검증이 둘 다 시각 순서를 믿었다
 *   ② 같은 원서에 두 트랜잭션이 동시에 기록하면 같은 앞 해시에 둘이 붙어 체인이 갈라진다
 * 그리고 이미 시각이 뒤집힌 채 쌓인 기록도 변조가 아니면 검증을 통과해야 한다.
 */
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let db: Db;
let available = false;
const applicants: string[] = [];
const applications: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newApplication(): Promise<string> {
  const applicantId = randomUUID();
  const applicationId = randomUUID();
  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-${applicantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'DRAFT')`,
    [applicationId, CYCLE, applicantId, TYPE, DEPT],
  );
  applicants.push(applicantId);
  applications.push(applicationId);
  return applicationId;
}

const saved = (applicationId: string) =>
  ({ applicationId, actorType: 'APPLICANT', action: 'APPLICATION_SAVED', result: 'ACCEPTED' }) as const;

async function chainRows(applicationId: string) {
  const { rows } = await db.query<{ id: string; prev_hash: string; event_hash: string; occurred_at: Date }>(
    `SELECT id, prev_hash, event_hash, occurred_at FROM audit_event WHERE application_id = $1 ORDER BY occurred_at, id`,
    [applicationId],
  );
  return rows;
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

afterEach(() => serverClock.reset());

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM audit_event WHERE application_id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM application WHERE id = ANY($1::uuid[])`, [applications]);
    await c.query(`DELETE FROM applicant WHERE id = ANY($1::uuid[])`, [applicants]);
  });
  await db.onApplicationShutdown();
});

describe('원서별 감사 체인 (D-62)', () => {
  it('시계 offset 이 뒤로 뛰어도 체인이 이어지고 시각이 거꾸로 가지 않는다', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const audit = new AuditService();
    const applicationId = await newApplication();

    await db.tx((c) => audit.record(c, saved(applicationId)));
    // 다음 측정에서 노드 시계가 0.5초 앞서 있었다고 나왔다 — 보정한 "지금" 이 0.5초 뒤로 간다
    serverClock.record({ offsetMs: 500, uncertaintyMs: 1, dbTimeMs: Date.now() - 500 });
    await db.tx((c) => audit.record(c, saved(applicationId)));
    await db.tx((c) => audit.record(c, saved(applicationId)));

    const rows = await chainRows(applicationId);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.prev_hash, GENESIS_HASH);
    assert.equal(rows[1]!.prev_hash, rows[0]!.event_hash, '두 번째가 첫 번째에 붙는다');
    assert.equal(rows[2]!.prev_hash, rows[1]!.event_hash, '세 번째가 두 번째에 붙는다 — 갈라지지 않는다');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i]!.occurred_at.getTime() > rows[i - 1]!.occurred_at.getTime(), '기록 시각은 앞 기록보다 뒤다');
    }
    const result = await db.tx((c) => audit.verifyChain(c, applicationId));
    assert.deepEqual(result, { valid: true, checked: 3 });
  });

  it('같은 원서에 동시에 기록해도 체인이 갈라지지 않는다', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const audit = new AuditService();
    const applicationId = await newApplication();
    await db.tx((c) => audit.record(c, saved(applicationId)));

    // 첫 트랜잭션이 기록하고 커밋 전에 머무는 동안 두 번째가 기록한다
    const first = db.tx(async (c) => {
      await audit.record(c, saved(applicationId));
      await sleep(400);
    });
    await sleep(100);
    const second = db.tx((c) => audit.record(c, { ...saved(applicationId), actorType: 'SYSTEM', action: 'DOCUMENT_VERIFIED' }));
    await Promise.all([first, second]);

    const rows = await chainRows(applicationId);
    assert.equal(rows.length, 3);
    const prevs = new Set(rows.map((r) => r.prev_hash));
    assert.equal(prevs.size, 3, '앞 해시가 겹치는 기록이 없다');
    const result = await db.tx((c) => audit.verifyChain(c, applicationId));
    assert.deepEqual(result, { valid: true, checked: 3 });
  });

  it('이미 시각이 뒤집힌 채 쌓인 기록도 연결이 맞으면 통과하고, 갈라진 체인·빠진 기록은 끊김이다', { skip: !process.env.DATABASE_URL }, async () => {
    if (!available) return;
    const audit = new AuditService();
    // 고치기 전 코드가 남긴 모양을 그대로 만든다 — 연결은 A→B→C 인데 B 의 시각이 A 보다 앞선다
    const hash = (prev: string, f: Record<string, unknown>) =>
      (audit as unknown as { chainHash(p: string, f: Record<string, unknown>): string }).chainHash(prev, f);
    const insert = async (applicationId: string, prev: string, at: Date) => {
      const id = randomUUID();
      const fields = {
        eventId: id, occurredAt: at.toISOString(), applicationId, actorType: 'APPLICANT', actorId: null,
        action: 'APPLICATION_SAVED', result: 'ACCEPTED', configVersion: null, policyVersion: null,
      };
      const eventHash = hash(prev, fields);
      await db.query(
        `INSERT INTO audit_event (id, application_id, actor_type, action, result, prev_hash, event_hash, details_redacted, occurred_at)
         VALUES ($1,$2,'APPLICANT','APPLICATION_SAVED','ACCEPTED',$3,$4,'{}',$5)`,
        [id, applicationId, prev, eventHash, at],
      );
      return { id, eventHash };
    };
    const t = Date.now();

    const inverted = await newApplication();
    const a = await insert(inverted, GENESIS_HASH, new Date(t));
    const b = await insert(inverted, a.eventHash, new Date(t - 120));
    await insert(inverted, b.eventHash, new Date(t + 50));
    assert.deepEqual(await db.tx((c) => audit.verifyChain(c, inverted)), { valid: true, checked: 3 });
    // 이어 쓰는 기록은 시각이 아니라 연결의 끝(C)에 붙는다
    await db.tx((c) => audit.record(c, saved(inverted)));
    assert.deepEqual(await db.tx((c) => audit.verifyChain(c, inverted)), { valid: true, checked: 4 });

    const forked = await newApplication();
    const f1 = await insert(forked, GENESIS_HASH, new Date(t));
    await insert(forked, f1.eventHash, new Date(t + 10));
    const fork = await insert(forked, f1.eventHash, new Date(t + 20));
    const forkResult = await db.tx((c) => audit.verifyChain(c, forked));
    assert.equal(forkResult.valid, false, '같은 앞 해시에 둘이 붙은 체인은 끊김이다');
    assert.equal(forkResult.brokenAt, fork.id);

    const gap = await newApplication();
    const g1 = await insert(gap, GENESIS_HASH, new Date(t));
    const missing = await insert(gap, g1.eventHash, new Date(t + 10));
    const orphan = await insert(gap, missing.eventHash, new Date(t + 20));
    await breakGlass((c) => c.query(`DELETE FROM audit_event WHERE id = $1`, [missing.id]));
    const gapResult = await db.tx((c) => audit.verifyChain(c, gap));
    assert.equal(gapResult.valid, false, '중간 기록을 지우면 끊김이다');
    assert.equal(gapResult.brokenAt, orphan.id);
  });
});
