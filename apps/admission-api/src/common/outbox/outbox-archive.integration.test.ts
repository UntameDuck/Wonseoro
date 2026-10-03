import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { breakGlass } from '../../test-support/break-glass';
import { archiveOutbox } from './outbox-archive';

/**
 * Outbox 보관 — 실제 DB 로 (T-M4-10, §01 B7, 0005)
 * 오래된 전송 완료 이벤트를 영수증과 함께 월별 파티션으로 옮기고, 원서마다 마지막 순번은 남기고, 보관 기간이 지난 달은 파티션째 지운다.
 */
let db: Db;
let available = false;
const agg = randomUUID();
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

async function event(id: string, seq: number, status: string, createdDaysAgo: number, receipt: boolean): Promise<void> {
  await db.query(
    `INSERT INTO outbox_event (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash, status, created_at, sent_at)
     VALUES ($1, $2, $3, 'kr.wonseoro.admission.application.finalized', '1', '{"n":1}', 'h', $4::varchar,
             now() - make_interval(days => $5), CASE WHEN $4::varchar = 'SENT' THEN now() - make_interval(days => $5) END)`,
    [id, agg, seq, status, createdDaysAgo],
  );
  if (receipt) {
    await db.query(
      `INSERT INTO sync_receipt (id, outbox_event_id, central_receipt_id, acknowledged_at, receipt_hash) VALUES ($1, $2, $3, now(), 'rh')`,
      [randomUUID(), id, `rcpt-${seq}`],
    );
  }
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  await event(ids[0] as string, 1, 'SENT', 60, true); // 두 달 전 — 옮긴다
  await event(ids[1] as string, 2, 'SENT', 30, true); // 한 달 전 — 옮긴다
  await event(ids[2] as string, 3, 'DEAD', 30, false); // 버려진 이벤트 — 사람이 봐야 한다
  await event(ids[3] as string, 4, 'SENT', 2, true); // 아직 이르다
  await event(ids[4] as string, 5, 'SENT', 40, true); // 이 원서의 마지막 순번 — 남긴다
  // 보관 기간(13개월)이 지난 달의 파티션 — 지워져야 한다
  await breakGlass((c) =>
    c.query(`CREATE TABLE IF NOT EXISTS kadmission.outbox_event_archive_202401 PARTITION OF kadmission.outbox_event_archive
               FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')`),
  );
});

after(async () => {
  if (!available) return;
  await breakGlass(async (c) => {
    await c.query(`DELETE FROM kadmission.outbox_event_archive WHERE aggregate_id = $1`, [agg]);
    await c.query(`DELETE FROM kadmission.sync_receipt WHERE outbox_event_id = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM kadmission.outbox_event WHERE aggregate_id = $1`, [agg]);
    await c.query(`DROP TABLE IF EXISTS kadmission.outbox_event_archive_202401`);
  });
  await db.onApplicationShutdown();
});

describe('Outbox 보관 (T-M4-10)', () => {
  it('오래된 전송 완료 이벤트만 영수증과 함께 옮기고, 마지막 순번·DEAD·최근 것은 남긴다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await archiveOutbox(db, { afterDays: 7, keepMonths: 13, batch: 100 });
    assert.ok(r.moved >= 2);

    const hot = await db.query<{ aggregate_sequence: string; status: string }>(
      `SELECT aggregate_sequence::text, status FROM outbox_event WHERE aggregate_id = $1 ORDER BY aggregate_sequence`,
      [agg],
    );
    assert.deepEqual(hot.rows.map((x) => `${x.aggregate_sequence}:${x.status}`), ['3:DEAD', '4:SENT', '5:SENT']);
    const archived = await db.query<{ aggregate_sequence: string; central_receipt_id: string }>(
      `SELECT aggregate_sequence::text, central_receipt_id FROM outbox_event_archive WHERE aggregate_id = $1 ORDER BY aggregate_sequence`,
      [agg],
    );
    assert.deepEqual(archived.rows.map((x) => `${x.aggregate_sequence}:${x.central_receipt_id}`), ['1:rcpt-1', '2:rcpt-2'], '영수증이 같이 간다');
    const receipts = await db.query(`SELECT 1 FROM sync_receipt WHERE outbox_event_id = ANY($1::uuid[])`, [[ids[0], ids[1]]]);
    assert.equal(receipts.rows.length, 0, '옮긴 이벤트의 영수증은 바로 쓰는 표에서 빠진다');

    // 다음 순번은 그대로 이어진다(MAX()+1 — finalization·cancellation 과 같은 계산)
    const next = await db.query<{ next: string }>(
      `SELECT (COALESCE(MAX(aggregate_sequence), 0) + 1)::text AS next FROM outbox_event WHERE aggregate_id = $1`,
      [agg],
    );
    assert.equal(next.rows[0]?.next, '6');
  });

  it('보관 기간이 지난 달은 파티션째 지우고, 다음 달 파티션을 미리 만든다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const r = await archiveOutbox(db, { afterDays: 7, keepMonths: 13, batch: 100 });
    // 앞 시험의 실행이 이미 지웠을 수 있다 — 지금 남아 있지 않으면 된다
    const left = await db.query(`SELECT to_regclass('kadmission.outbox_event_archive_202401') AS t`);
    assert.equal((left.rows[0] as { t: unknown }).t, null);
    const months = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhparent WHERE c.relname = 'outbox_event_archive'
         AND i.inhrelid::regclass::text >= 'kadmission.outbox_event_archive_' || to_char(now() + interval '3 months', 'YYYYMM')`,
    );
    assert.ok(Number(months.rows[0]?.n) >= 1, '석 달 뒤 파티션까지 있다');
    assert.ok(Array.isArray(r.partitionsDropped));
  });

  it('앱 역할은 보관 표를 고치거나 지울 수 없고, 파티션을 직접 만들 수 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    await assert.rejects(db.query(`DELETE FROM outbox_event_archive WHERE aggregate_id = $1`, [agg]), /permission denied/);
    await assert.rejects(db.query(`UPDATE outbox_event_archive SET status = 'X' WHERE aggregate_id = $1`, [agg]), /permission denied/);
    await assert.rejects(
      db.query(`CREATE TABLE outbox_event_archive_209901 PARTITION OF outbox_event_archive FOR VALUES FROM ('2099-01-01') TO ('2099-02-01')`),
      /permission denied/,
    );
  });
});
