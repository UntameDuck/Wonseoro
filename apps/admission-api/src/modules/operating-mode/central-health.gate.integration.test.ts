import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import type { CentralHealthGate as Gate } from './central-health.gate';

/**
 * Central Dependency Health Gate 통합 테스트 — 실제 PostgreSQL 이 필요하다. (v1.1 §A1)
 *
 * 중앙 응답은 흉내 낸다. 적체는 실제 outbox_event 로 센다.
 */

// 설정은 import 시점에 확정된다. 불러오기 전에 정한다.
process.env.BREAKER_FAILURE_THRESHOLD = '2';
process.env.BREAKER_OPEN_MS = '1000';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.SYNC_LAG_WARN_SECONDS = '600';
process.env.UNIVERSITY_ID ??= 'UNIV-A';

let db: Db;
let available = false;
let makeGate: () => Gate;
const aggregateId = randomUUID();

const up = () => Promise.resolve(new Response('{}', { status: 200 }));
const down = () =>
  Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  const { CentralHealthGate } = await import('./central-health.gate');
  const { DependencyBreakers } = await import('../../common/resilience/dependency-breakers');
  makeGate = () => {
    const gate = new CentralHealthGate(db, new DependencyBreakers());
    gate.centralUrl = 'http://central.test';
    return gate;
  };
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [aggregateId]);
  await db.onApplicationShutdown();
});

describe('Central Dependency Health Gate (v1.1 §A1)', () => {
  it('중앙 주소가 없으면 자율 운영이다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gate = makeGate();
    gate.centralUrl = '';
    const s = await gate.tick(up);
    assert.equal(s.mode, 'AUTONOMOUS');
    assert.equal(s.reason, 'CENTRAL_NOT_CONFIGURED');
  });

  it('첫 확인 전에는 연결됐다고 말하지 않는다', (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(makeGate().current().mode, 'AUTONOMOUS');
  });

  it('중앙이 답하면 CONNECTED, 한 번 실패로는 바뀌지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gate = makeGate();
    const connected = await gate.tick(up);
    assert.equal(connected.mode, 'CONNECTED');
    assert.equal(connected.reason, null);
    assert.ok(connected.lastCentralContactAt);

    // 순간 실패에 배너가 깜빡이면 안 된다.
    const blip = await gate.tick(down);
    assert.equal(blip.mode, 'CONNECTED');
    assert.equal(blip.lastCentralContactAt, connected.lastCentralContactAt);
  });

  it('연속 실패로 회로가 열리면 AUTONOMOUS, 열린 동안은 중앙에 묻지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gate = makeGate();
    await gate.tick(up);
    await gate.tick(down);
    const s = await gate.tick(down);
    assert.equal(s.mode, 'AUTONOMOUS');
    assert.equal(s.reason, 'CENTRAL_UNREACHABLE');
    assert.ok(Date.parse(s.since) >= Date.parse(s.lastCentralContactAt!), '전환 시각이 새로 찍힌다');

    let asked = false;
    await gate.tick(() => {
      asked = true;
      return up();
    });
    assert.equal(asked, false);
    assert.equal(gate.current().mode, 'AUTONOMOUS');
  });

  it('중앙이 살아나면 주기 확인이 탐침이 되어 CONNECTED 로 돌아온다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gate = makeGate();
    await gate.tick(down);
    await gate.tick(down);
    assert.equal(gate.current().mode, 'AUTONOMOUS');

    await wait(1050);
    const s = await gate.tick(up);
    assert.equal(s.mode, 'CONNECTED');
    assert.equal(s.reason, null);
  });

  it('중앙 반영이 밀리면 lagging 을 세운다 — relay 가 죽어도 보인다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // relay 에 묻지 않고 DB 를 직접 센다. 한 시간 묵은 미전송 이벤트를 만든다.
    await db.query(
      `INSERT INTO outbox_event
         (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash,
          created_at)
       VALUES ($1,$2,1,'kr.k-admission.application.finalized.v1','1.0','{}','h',
               now() - interval '1 hour')`,
      [randomUUID(), aggregateId],
    );
    try {
      const s = await makeGate().tick(up);
      assert.equal(s.sync.lagging, true);
      assert.ok(s.sync.pendingEvents >= 1);
      assert.ok(s.sync.oldestPendingAgeSeconds >= 3600);
      // 중앙은 살아 있어도 반영은 밀릴 수 있다. 둘은 다른 신호다.
      assert.equal(s.mode, 'CONNECTED');
    } finally {
      await db.query(`DELETE FROM outbox_event WHERE aggregate_id = $1`, [aggregateId]);
    }
  });
});
