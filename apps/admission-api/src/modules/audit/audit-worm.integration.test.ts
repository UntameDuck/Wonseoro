import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectRetentionCommand, S3Client } from '@aws-sdk/client-s3';
import { Db } from '@wonseoro/server-kit';
import { breakGlass } from '../../test-support/break-glass';
import { Client } from 'pg';
import {
  S3WormStore,
  exportAuditSegment,
  exportGrantSegment,
  loadWormVerify,
  verifyAllWorm,
  verifyAuditWorm,
  verifyGrantWorm,
  verifyWormIfDue,
  wormVerifyJob,
} from './audit-worm';

/**
 * 감사 기록 WORM — 실제 S3 호환 Object Lock 으로 (T-M3-03, D-75)
 * DB 슈퍼유저가 감사 기록을 고치거나 지워도 WORM 조각과 맞춰 찾아낸다. 조각은 보관 기간 동안 지울 수 없다.
 * Object Storage(:9000)·DB 가 없으면 건너뛴다. 시험마다 새 버킷(Object Lock 버킷은 잠긴 조각이 있으면 지울 수 없다 — 보관 1일)
 */
const ENDPOINT = process.env.WORM_TEST_S3_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = `audit-worm-it-${Date.now()}`;
const UNIV = `WORM-${randomUUID().slice(0, 6)}`;
const client = new S3Client({ region: 'us-east-1', endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'wonseoro', secretAccessKey: 'wonseoro123' } });
const store = new S3WormStore(client, BUCKET);
const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
const applicantId = randomUUID();
const applicationId = randomUUID();
let db: Db;
let available = false;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  if (!(await db.healthy())) return;
  try {
    await store.ensureBucket();
  } catch {
    return; // Object Storage 없음
  }
  available = true;
  // 이 시험만의 원서에 붙인다 — 원서 없는 기록(운영자 체인)에 가짜 해시를 넣으면 동시에 도는 체인 검사 시험이 깨진다
  await db.query(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ($1, $2, '\\x00', 'none')`, [applicantId, `subj-worm-${applicantId.slice(0, 8)}`]);
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1, '11111111-1111-1111-1111-111111111111', $2, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'CANCELLED')`,
    [applicationId, applicantId],
  );
  for (const [i, id] of ids.entries()) {
    await db.query(
      `INSERT INTO audit_event (id, application_id, actor_type, actor_id, action, result, event_hash, details_redacted, occurred_at)
       VALUES ($1, $4, 'SYSTEM', 'worm-test', 'WORM_TEST', 'ACCEPTED', $2, '{"n":1}', now() - interval '10 minutes' + make_interval(secs => $3))`,
      [id, `hash-${i}`, i, applicationId],
    );
  }
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM audit_event WHERE application_id = $1`, [applicationId]);
    await c.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
    await c.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
    await c.query(`DELETE FROM scheduled_job_run WHERE job = $1`, [wormVerifyJob(UNIV)]);
  });
  await db.onApplicationShutdown();
});

describe('감사 기록 WORM (T-M3-03)', () => {
  let firstKey = '';

  it('감사 기록을 조각으로 내보내고, 이어서 내보내면 겹치지 않는다', async (t) => {
    if (!available) return t.skip('DB·Object Storage 없음');
    const opts = { university: UNIV, settleSeconds: 60, batch: 100_000, retentionDays: 1 };
    const first = await exportAuditSegment(db, store, opts);
    assert.ok(first.exported >= 3 && first.key);
    firstKey = first.key as string;
    const body = (await store.get(firstKey)).toString('utf8');
    for (const id of ids) assert.ok(body.includes(id));
    // 이어서 내보내면 겹치지 않는다(키 이름이 이어 내보낼 자리). 0건을 기대하지 않는다 — 동시에 도는 시험이 남긴
    // 기록이 그사이 settleSeconds 를 넘겨 새 조각으로 나갈 수 있다
    const again = await exportAuditSegment(db, store, opts);
    if (again.key) {
      const next = (await store.get(again.key)).toString('utf8');
      const firstIds = body.trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id);
      assert.deepEqual(firstIds.filter((id) => next.includes(id)), [], '이미 내보낸 기록은 다시 내보내지 않는다');
      assert.ok(again.key > firstKey, '다음 조각은 앞 조각 뒤에 이어진다');
    }
  });

  it('조각은 보관 기간 동안 지울 수도 보관을 줄일 수도 없다(COMPLIANCE)', async (t) => {
    if (!available) return t.skip('DB·Object Storage 없음');
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: firstKey }));
    assert.equal(head.ObjectLockMode, 'COMPLIANCE');
    await assert.rejects(client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId })));
    await assert.rejects(
      client.send(new PutObjectRetentionCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId, Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(Date.now() + 60_000) } })),
    );
  });

  it('DB 에서 고치거나 지운 감사 기록을 WORM 과 맞춰 찾아낸다(슈퍼유저가 트리거를 꺼도)', async (t) => {
    if (!available) return t.skip('DB·Object Storage 없음');
    const clean = await verifyAuditWorm(db, store, UNIV);
    assert.equal(clean.alteredInDb.filter((x) => ids.includes(x)).length, 0);
    await breakGlass(async (c) => {
      await c.query(`UPDATE audit_event SET result = 'REJECTED' WHERE id = $1`, [ids[0]]);
      await c.query(`DELETE FROM audit_event WHERE id = $1`, [ids[1]]);
    });
    const r = await verifyAuditWorm(db, store, UNIV);
    assert.ok(r.alteredInDb.includes(ids[0] as string), '고친 기록');
    assert.ok(r.missingInDb.includes(ids[1] as string), '지운 기록');
    assert.ok(!r.alteredInDb.includes(ids[2] as string) && !r.missingInDb.includes(ids[2] as string), '손대지 않은 기록은 그대로');
  });

  it('권한 변경 기록도 순번으로 이어 내보내고, 트리거를 끄고 고치거나 지운 줄을 WORM 과 맞춰 찾아낸다 (G-15, D-91)', async (t) => {
    if (!available) return t.skip('DB·Object Storage 없음');
    const run = randomUUID().slice(0, 8);
    for (let i = 0; i < 2; i++) {
      await db.query(
        `INSERT INTO access_grant_log (source, source_event_id, occurred_at, action, change_kind, subject, roles, row_hash)
         VALUES ('IDP', $1, now(), 'BASELINE', 'BASELINE', $2, ARRAY['support-agent'], '')`,
        [`worm-it:${run}:${i}`, `worm-${run}`],
      );
    }
    const mine = (await db.query<{ seq: string }>(`SELECT seq::text FROM access_grant_log WHERE subject = $1 ORDER BY seq`, [`worm-${run}`])).rows.map((r) => r.seq);
    const opts = { university: UNIV, batch: 100_000, retentionDays: 1 };
    const first = await exportGrantSegment(db, store, opts);
    assert.ok(first.key && first.exported >= 2);
    assert.match(first.key, /^access-grants\/.+\/\d{4}-\d{2}-\d{2}\/\d{12}\.ndjson$/);
    const body = (await store.get(first.key)).toString('utf8');
    for (const s of mine) assert.ok(body.includes(`"seq":"${s}"`));
    // 이어 내보내면 앞 조각의 순번은 다시 나가지 않는다
    const again = await exportGrantSegment(db, store, opts);
    if (again.key) assert.ok(!(await store.get(again.key)).toString('utf8').includes(`"seq":"${mine[0]}"`));
    const clean = await verifyGrantWorm(db, store, UNIV);
    assert.deepEqual([...clean.alteredInDb, ...clean.missingInDb].filter((s) => mine.includes(s)), []);

    // 슈퍼유저가 트리거를 끄고 고치거나 지운 것 — 트랜잭션 안에서 보고 되돌린다(추가 전용 표를 시험이 실제로 망가뜨리지 않게)
    const su = new Client({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL, options: '-c search_path=kadmission,public' });
    await su.connect();
    try {
      await su.query('BEGIN');
      await su.query(`SET LOCAL session_replication_role = replica`);
      await su.query(`UPDATE access_grant_log SET roles = ARRAY['break-glass'] WHERE seq = $1`, [mine[0]]);
      await su.query(`DELETE FROM access_grant_log WHERE seq = $1`, [mine[1]]);
      const r = await verifyGrantWorm(su, store, UNIV);
      assert.ok(r.alteredInDb.includes(mine[0] as string), '고친 줄');
      assert.ok(r.missingInDb.includes(mine[1] as string), '지운 줄');
      // 정기 대조(스케줄러)가 쓰는 묶음 — 두 기록을 함께 본다
      const all = await verifyAllWorm(su, store, UNIV);
      assert.ok(all['access-grants'].missingInDb.includes(mine[1] as string));
      assert.ok(all.audit.segments >= 1);
    } finally {
      await su.query('ROLLBACK');
      await su.end();
    }
  });

  it('정기 대조는 DB 의 마지막 대조로 때를 정해 재시작해도 이어지고, 앞날 기록·오래 못 돈 프로세스는 기록을 믿지 않는다 (D-93)', async (t) => {
    if (!available) return t.skip('DB·Object Storage 없음');
    const hour = 3_600_000;
    const o = { university: UNIV, intervalMs: hour, processSince: Date.now() };
    const first = await verifyWormIfDue(db, store, o);
    assert.ok(first, '기록이 없으면 바로 대조한다');
    const rec = await loadWormVerify(db, UNIV);
    assert.ok(rec && Date.now() - rec.at < 60_000, '마지막 대조를 DB 에 남긴다');
    assert.deepEqual(rec.counts.audit, { missing: first.audit.missingInDb.length, altered: first.audit.alteredInDb.length });
    assert.deepEqual(rec.counts['access-grants'], { missing: first['access-grants'].missingInDb.length, altered: first['access-grants'].alteredInDb.length });
    // 막 다시 뜬 프로세스라도 DB 의 마지막 대조가 주기 안이면 하지 않는다(재시작마다 대조하지 않는다)
    assert.equal(await verifyWormIfDue(db, store, { ...o, processSince: Date.now() }), null);
    // 주기가 지났으면 한다
    assert.ok(await verifyWormIfDue(db, store, { ...o, now: Date.now() + 2 * hour }));
    // 이 프로세스가 주기만큼 대조하지 못했으면 DB 기록과 상관없이 한다(슈퍼유저가 기록을 고쳐 미뤄도)
    assert.ok(await verifyWormIfDue(db, store, { ...o, processSince: Date.now() - 2 * hour }));
    // 앞날로 고친 기록은 없는 것으로 본다 — 바로 대조하고 지금 시각으로 덮어쓴다
    await breakGlass((c) => c.query(`UPDATE scheduled_job_run SET last_success_at = now() + interval '1 day' WHERE job = $1`, [wormVerifyJob(UNIV)]));
    assert.equal(await loadWormVerify(db, UNIV), null);
    assert.ok(await verifyWormIfDue(db, store, { ...o, processSince: Date.now() }));
    const fixed = await loadWormVerify(db, UNIV);
    // DB 컨테이너와 호스트 시계가 조금 어긋날 수 있다 — 하루 뒤가 아니라 지금으로 덮어썼는지만 본다
    assert.ok(fixed && Math.abs(fixed.at - Date.now()) < 60_000, JSON.stringify({ fixed, now: Date.now() }));
  });
});