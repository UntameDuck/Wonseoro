import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Db } from '@wonseoro/server-kit';
import type { RelayService as RelayServiceType } from './relay.service';

/**
 * Outbox 전송 trace 전파 (T-M4-20) — 실제 PostgreSQL 이 필요하다.
 *
 * 이벤트 한 건이 relay 에서 span 하나가 되고, 그 traceparent 가 중앙 요청 헤더로 넘어가는지 본다.
 * 중앙은 그 헤더를 이어 받아 수신 처리를 같은 trace 로 남긴다(installHttpTelemetry).
 * 이벤트 본문·원서 식별자는 span 속성에 들어가지 않아야 한다.
 */
process.env.RELAY_AUTOSTART = 'false';
process.env.UNIVERSITY_ID ??= 'UNIV-TEST';

const exporter = new InMemorySpanExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
);

let db: Db;
let available = false;
let skipReason = 'DATABASE_URL 없음';
let relay: RelayServiceType;
let central: Server;
const received: Array<string | undefined> = [];
const aggregateId = randomUUID();
const SENTINEL = 'trace-check-applicant@example.com';

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
    received.push(req.headers.traceparent as string | undefined);
    req.resume();
    req.on('end', () => {
      res.writeHead(202, { 'content-type': 'application/json' }).end(
        JSON.stringify({ receiptId: `rcpt-${randomUUID()}`, acknowledgedAt: new Date().toISOString() }),
      );
    });
  });
  await new Promise<void>((r) => central.listen(0, '127.0.0.1', () => r()));
  process.env.CENTRAL_SYNC_URL = `http://127.0.0.1:${(central.address() as AddressInfo).port}`;

  const { RelayService } = await import('./relay.service');
  relay = new RelayService(db);

  await db.query(
    `INSERT INTO outbox_event
       (id, aggregate_id, aggregate_sequence, event_type, schema_version, payload, payload_hash)
     VALUES ($1,$2,1,'kr.k-admission.application.finalized.v1','1.0',$3,'h')`,
    [randomUUID(), aggregateId, JSON.stringify({ email: SENTINEL })],
  );
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

describe('Outbox 전송 trace 전파 (T-M4-20)', () => {
  it('이벤트 한 건 = PRODUCER span 한 개, 같은 trace 가 중앙 요청 헤더로 간다', async (t) => {
    if (!available) return t.skip(skipReason);

    const stats = await relay.drainOnce();
    assert.equal(stats.sent, 1);

    const spans = exporter.getFinishedSpans().filter((s) => s.name === 'outbox publish');
    assert.equal(spans.length, 1);
    const span = spans[0]!;
    assert.equal(span.kind, SpanKind.PRODUCER);
    assert.equal(span.attributes['cloudevents.event_type'], 'kr.k-admission.application.finalized.v1');

    assert.equal(received.length, 1);
    const ctx = span.spanContext();
    assert.equal(received[0], `00-${ctx.traceId}-${ctx.spanId}-01`);

    // 본문·원서 식별자는 span 에 없다
    const dump = JSON.stringify(spans.map((s) => ({ attributes: s.attributes, name: s.name })));
    assert.equal(dump.includes(SENTINEL), false);
    assert.equal(dump.includes(aggregateId), false);
  });
});
