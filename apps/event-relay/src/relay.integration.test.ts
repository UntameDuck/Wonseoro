import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import type { RelayService as RelayServiceType } from './relay.service';

/**
 * Outbox Relay × 중앙 장애 통합 테스트 — 실제 PostgreSQL 이 필요하다. (v1.1 §01 C8·§B7)
 *
 * 중앙 Sync Gateway 자리에 가짜 HTTP 서버를 세우고, 끄고 켜면서 relay 를 돌린다.
 *
 * 확인할 것
 *   - 중앙이 죽은 동안 이벤트가 DEAD 로 떨어지지 않는다
 *   - 끊긴 뒤에는 중앙에 요청하지 않는다 (반열림 탐침 한 건 제외)
 *   - 중앙이 살아나면 저절로 다 보낸다
 *
 * relay 는 DB 전체의 PENDING 을 집는다. 다른 대기 이벤트가 있으면 그것까지
 * 가짜 중앙으로 보내 SENT 로 바꿔버리므로, 그때는 실행하지 않는다.
 */

// 설정은 import 시점에 확정된다. relay 를 불러오기 전에 정한다.
process.env.BREAKER_FAILURE_THRESHOLD = '2';
process.env.BREAKER_OPEN_MS = '1000';
process.env.RELAY_AUTOSTART = 'false';
process.env.UNIVERSITY_ID ??= 'UNIV-TEST';

const OPEN_MS = 1000;
const EVENTS = 5;

let db: Db;
let available = false;
let skipReason = 'DATABASE_URL 없음';
let relay: RelayServiceType;
let central: Server;
let centralUp = false;
let centralHits = 0;
const aggregateId = randomUUID();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rows(): Promise<Array<{ status: string; attempt_count: number }>> {
  const res = await db.query<{ status: string; attempt_count: number }>(
    `SELECT status, attempt_count FROM outbox_event
      WHERE aggregate_id = $1 ORDER BY aggregate_sequence`,
    [aggregateId],
  );
  return res.rows;
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('event-relay', 'kadmission');
  if (!(await db.healthy())) return;

  const { rows: others } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM outbox_event WHERE status IN ('PENDING','SENDING')`,
  );
  if (Number(others[0]?.n ?? 0) > 0) {
    skipReason = '다른 대기 이벤트가 있어 가짜 중앙으로 보내게 된다';
    return;
  }

  central = createServer((req, res) => {
    centralHits += 1;
    req.resume();
    req.on('end', () => {
      if (!centralUp) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(202, { 'content-type': 'application/json' }).end(
        JSON.stringify({ receiptId: `rcpt-${randomUUID()}`, acknowledgedAt: new Date().toISOString() }),
      );
    });
  });
  await new Promise<void>((r) => central.listen(0, '127.0.0.1', () => r()));
  process.env.CENTRAL_SYNC_URL = `http://127.0.0.1:${(central.address() as AddressInfo).port}`;

  const { RelayService } = await import('./relay.service');
  relay = new RelayService(db);

  for (let seq = 1; seq <= EVENTS; seq += 1) {
    await db.query(
      `INSERT INTO outbox_event
         (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash)
       VALUES ($1,$2,$3,'kr.k-admission.application.finalized.v1','1.0',$4,'h')`,
      [randomUUID(), aggregateId, seq, JSON.stringify({ seq })],
    );
  }
  available = true;
});

after(async () => {
  if (central) await new Promise((r) => central.close(r));
  if (!db) return;
  if (available) {
    await db.query(
      `DELETE FROM sync_receipt WHERE outbox_event_id IN
         (SELECT id FROM outbox_event WHERE aggregate_id = $1)`,
      [aggregateId],
    );
    await db.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [aggregateId]);
  }
  await db.onApplicationShutdown();
});

describe('중앙 장애 중 Outbox Relay (v1.1 §01 C8)', () => {
  it('연속 실패로 회로가 열리면 남은 행은 재시도 횟수를 쓰지 않고 되돌린다', async (t) => {
    if (!available) return t.skip(skipReason);
    const stats = await relay.drainOnce();

    // 첫 실패는 회로가 닫혀 있을 때라 평소처럼 센다. 두 번째 실패가 회로를 연다.
    assert.equal(stats.failed, 1);
    assert.equal(stats.held, EVENTS - 1);
    assert.equal(stats.circuit, 'OPEN');
    assert.equal(centralHits, 2, '열린 뒤에는 중앙에 요청하지 않는다');

    const now = await rows();
    assert.ok(now.every((r) => r.status === 'PENDING'), 'SENDING 으로 잠긴 채 남으면 안 된다');
    assert.deepEqual(
      now.map((r) => r.attempt_count),
      [1, 0, 0, 0, 0],
    );
  });

  it('열려 있는 동안에는 행을 집지도, 중앙에 묻지도 않는다', async (t) => {
    if (!available) return t.skip(skipReason);
    const before = centralHits;
    const stats = await relay.drainOnce();
    assert.equal(stats.sent + stats.failed + stats.held, 0);
    assert.equal(centralHits, before);
  });

  it('장애가 길어져도 탐침은 한 건씩이고, 이벤트가 DEAD 로 떨어지지 않는다', async (t) => {
    if (!available) return t.skip(skipReason);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await wait(OPEN_MS + 50);
      const before = centralHits;
      const stats = await relay.drainOnce();
      assert.equal(centralHits - before, 1, '반열림 탐침은 한 건');
      assert.equal(stats.held, 1);
      assert.equal(stats.circuit, 'OPEN');
    }
    const now = await rows();
    assert.ok(now.every((r) => r.status === 'PENDING'));
    assert.ok(
      now.every((r) => r.attempt_count <= 1),
      '중앙 장애는 이벤트의 잘못이 아니다 — 재시도 횟수를 쓰면 안 된다',
    );
  });

  it('중앙이 살아나면 회로가 닫히고 밀린 이벤트를 전부 보낸다', async (t) => {
    if (!available) return t.skip(skipReason);
    centralUp = true;
    await wait(OPEN_MS + 50);

    const probe = await relay.drainOnce();
    assert.equal(probe.sent, 1, '반열림에서는 한 건만 보내 본다');
    assert.equal(probe.circuit, 'CLOSED');

    for (let i = 0; i < 5 && (await rows()).some((r) => r.status !== 'SENT'); i += 1) {
      await relay.drainOnce();
      await wait(200);
    }
    const now = await rows();
    assert.deepEqual(
      now.map((r) => r.status),
      Array(EVENTS).fill('SENT'),
    );
  });
});
