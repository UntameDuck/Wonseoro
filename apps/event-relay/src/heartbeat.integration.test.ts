import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { Db } from '@wonseoro/server-kit';
import type { HeartbeatService as HeartbeatServiceType } from './heartbeat.service';

/**
 * 대학 상태 심장박동 (§04 sync.heartbeat, D-60) — 실제 PostgreSQL 이 필요하다.
 *
 * 가짜 중앙이 받은 본문을 **계약 스키마 그대로** 검증한다. 스키마와 다르면 진짜 중앙도
 * 거절하고, 그러면 중앙은 이 대학을 "확인 불가" 로 본다.
 */
process.env.BREAKER_FAILURE_THRESHOLD = '2';
process.env.BREAKER_OPEN_MS = '60000';
process.env.RELAY_AUTOSTART = 'false';
process.env.UNIVERSITY_ID ??= 'UNIV-TEST';
process.env.PLATFORM_VERSION = 'test-1.4.0';

let db: Db;
let available = false;
let central: Server;
let centralUp = true;
const received: unknown[] = [];
let heartbeat: HeartbeatServiceType;

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '../../../packages/contracts/events/k-admission-cloudevents.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateEvent = ajv.compile(schema);

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('event-relay', 'kadmission');
  available = await db.healthy();
  if (!available) return;

  central = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!centralUp) {
        res.writeHead(503).end();
        return;
      }
      received.push(JSON.parse(body));
      res.writeHead(202, { 'content-type': 'application/json' }).end(
        JSON.stringify({ eventId: 'x', receiptId: 'HB-X', acknowledgedAt: new Date().toISOString() }),
      );
    });
  });
  await new Promise<void>((r) => central.listen(0, '127.0.0.1', () => r()));
  process.env.CENTRAL_SYNC_URL = `http://127.0.0.1:${(central.address() as AddressInfo).port}`;

  const { RelayService } = await import('./relay.service');
  const { HeartbeatService } = await import('./heartbeat.service');
  heartbeat = new HeartbeatService(db, new RelayService(db));
});

after(async () => {
  if (!available) return;
  await new Promise<void>((r) => central.close(() => r()));
  await db.onApplicationShutdown();
});

describe('대학 상태 심장박동 (§04, D-60)', () => {
  it('적체·설정 버전·시계 offset 을 계약 스키마대로 보낸다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(await heartbeat.beat(), true);
    const event = received.at(-1) as { type: string; data: Record<string, unknown> };
    assert.ok(validateEvent(event), JSON.stringify(validateEvent.errors));
    assert.equal(event.type, 'kr.kadmission.sync.heartbeat.v1');
    assert.equal(event.data.platformVersion, 'test-1.4.0');
    assert.equal(typeof event.data.pendingOutbox, 'number');
    assert.equal(typeof event.data.clockOffsetMs, 'number');
  });

  it('중앙이 끊기면 쌓지 않고 건너뛴다 — 지난 상태를 나중에 현재처럼 보내지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    centralUp = false;
    const before = received.length;
    assert.equal(await heartbeat.beat(), false);
    assert.equal(await heartbeat.beat(), false);
    // 회로가 열리면 묻지도 않는다
    assert.equal(await heartbeat.beat(), false);
    centralUp = true;
    assert.equal(received.length, before, '끊긴 동안 보낸 것이 없다');
  });
});
