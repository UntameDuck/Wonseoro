import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectRetentionCommand, S3Client } from '@aws-sdk/client-s3';
import { Db } from '@wonseoro/server-kit';
import { breakGlass } from '../../test-support/break-glass';
import { S3WormStore, exportAuditSegment, verifyAuditWorm } from './audit-worm';

/**
 * 감사 기록 WORM — 실제 MinIO Object Lock 으로 (T-M3-03, D-75)
 * DB 슈퍼유저가 감사 기록을 고치거나 지워도 WORM 조각과 맞춰 찾아낸다. 조각은 보관 기간 동안 지울 수 없다.
 * MinIO(:9000)·DB 가 없으면 건너뛴다. 시험마다 새 버킷(Object Lock 버킷은 잠긴 조각이 있으면 지울 수 없다 — 보관 1일)
 */
const ENDPOINT = process.env.WORM_TEST_S3_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = `audit-worm-it-${Date.now()}`;
const UNIV = `WORM-${randomUUID().slice(0, 6)}`;
const client = new S3Client({ region: 'us-east-1', endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'wonseoro', secretAccessKey: 'wonseoro123' } });
const store = new S3WormStore(client, BUCKET);
const ids = [randomUUID(), randomUUID(), randomUUID()];
let db: Db;
let available = false;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  if (!(await db.healthy())) return;
  try {
    await store.ensureBucket();
  } catch {
    return; // MinIO 없음
  }
  available = true;
  for (const [i, id] of ids.entries()) {
    await db.query(
      `INSERT INTO audit_event (id, actor_type, actor_id, action, result, event_hash, details_redacted, occurred_at)
       VALUES ($1, 'SYSTEM', 'worm-test', 'WORM_TEST', 'ACCEPTED', $2, '{"n":1}', now() - interval '10 minutes' + make_interval(secs => $3))`,
      [id, `hash-${i}`, i],
    );
  }
});

after(async () => {
  if (!available) return;
  await breakGlass((c) => c.query(`DELETE FROM audit_event WHERE id = ANY($1::uuid[])`, [ids]));
  await db.onApplicationShutdown();
});

describe('감사 기록 WORM (T-M3-03)', () => {
  let firstKey = '';

  it('감사 기록을 조각으로 내보내고, 이어서 내보내면 겹치지 않는다', async (t) => {
    if (!available) return t.skip('DB·MinIO 없음');
    const opts = { university: UNIV, settleSeconds: 60, batch: 100_000, retentionDays: 1 };
    const first = await exportAuditSegment(db, store, opts);
    assert.ok(first.exported >= 3 && first.key);
    firstKey = first.key as string;
    const again = await exportAuditSegment(db, store, opts);
    assert.equal(again.exported, 0, '이미 내보낸 기록은 다시 내보내지 않는다(키 이름이 이어 내보낼 자리)');
    const body = (await store.get(firstKey)).toString('utf8');
    for (const id of ids) assert.ok(body.includes(id));
  });

  it('조각은 보관 기간 동안 지울 수도 보관을 줄일 수도 없다(COMPLIANCE)', async (t) => {
    if (!available) return t.skip('DB·MinIO 없음');
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: firstKey }));
    assert.equal(head.ObjectLockMode, 'COMPLIANCE');
    await assert.rejects(client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId })));
    await assert.rejects(
      client.send(new PutObjectRetentionCommand({ Bucket: BUCKET, Key: firstKey, VersionId: head.VersionId, Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(Date.now() + 60_000) } })),
    );
  });

  it('DB 에서 고치거나 지운 감사 기록을 WORM 과 맞춰 찾아낸다(슈퍼유저가 트리거를 꺼도)', async (t) => {
    if (!available) return t.skip('DB·MinIO 없음');
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
});
