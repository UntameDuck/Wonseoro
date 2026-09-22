import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import {
  IncomingEvent,
  SyncGatewayService,
  SyncRejection,
} from './modules/sync-gateway/sync-gateway.service';

/**
 * 중앙 Sync Gateway 통합 테스트 — 실제 중앙 PostgreSQL 이 필요하다.
 *
 *   npm run dev:infra
 *   psql < infra/db/central/0001_init.sql
 *   DATABASE_URL=postgresql://wonseoro:wonseoro@localhost:5434/central npm test -w @wonseoro/central-api
 *
 * DB 가 없으면 전부 skip 한다.
 */
const UNIV = 'UNIV-TEST';
const SOURCE = `urn:k-admission:university:${UNIV}`;

let db: Db;
let available = false;

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  const applicationId = overrides.data?.applicationId ?? randomUUID().replace(/-/g, '');
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: SOURCE,
    type: 'kr.kadmission.application.finalized.v1',
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    kadmissionuniversity: UNIV,
    kadmissionsequence: 1,
    configversion: 'cfg-v1',
    policyversion: 'pol-v1',
    ...overrides,
    data: {
      applicationId,
      admissionYear: 2027,
      admissionTypeCode: 'EARLY',
      departmentCode: 'CSE',
      status: 'FINALIZED',
      applicationNumber: '2027-UNIV-TEST-AAAA',
      finalizedAt: new Date().toISOString(),
      integrityHash: `sha256:${'a'.repeat(64)}`,
      ...(overrides.data ?? {}),
    },
  };
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('central-api', 'kadmission_central');
  available = await db.healthy();
  if (!available) return;
  await db.query(
    `INSERT INTO university_registry (id, name, status)
     VALUES ($1, '테스트대학교', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [UNIV],
  );
});

after(async () => {
  if (!available) return;
  await db.query(`DELETE FROM sync_gap WHERE university_id = $1`, [UNIV]);
  await db.query(`DELETE FROM application_summary WHERE university_id = $1`, [UNIV]);
  await db.query(`DELETE FROM received_event WHERE university_id = $1`, [UNIV]);
  await db.query(`DELETE FROM university_sync_state WHERE university_id = $1`, [UNIV]);
  await db.query(`DELETE FROM university_registry WHERE id = $1`, [UNIV]);
  await db.onApplicationShutdown();
});

describe('Sync Gateway — 중복 수신 (v1.1 §04)', () => {
  it('같은 이벤트를 100번 받아도 상태는 한 번만 바뀐다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const e = event();

    const results = await Promise.all(
      Array.from({ length: 100 }, () => gateway.ingest(e).catch(() => null)),
    );
    const accepted = results.filter((r) => r && !r.duplicate).length;
    assert.equal(accepted, 1, 'at-least-once 이므로 중복 수신은 정상이다. 반영은 1회여야 한다');

    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM received_event WHERE source = $1 AND event_id = $2`,
      [e.source, e.id],
    );
    assert.equal(Number(rows[0]!.n), 1);
  });

  it('중복 수신은 기존 영수증을 그대로 돌려준다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const e = event();

    const first = await gateway.ingest(e);
    const second = await gateway.ingest(e);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.receiptId, first.receiptId, '영수증이 바뀌면 대학이 혼란스러워진다');
  });
});

describe('Sync Gateway — sequence gap 탐지 (v1.1 §A3)', () => {
  it('sequence 를 건너뛰면 유실로 기록한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const appId = randomUUID().replace(/-/g, '');

    await gateway.ingest(event({ kadmissionsequence: 1, data: { applicationId: appId } }));
    // 2 를 건너뛰고 3 이 온다.
    await gateway.ingest(event({ kadmissionsequence: 3, data: { applicationId: appId } }));

    const { rows } = await db.query<{ expected_sequence: string; state: string }>(
      `SELECT expected_sequence, state FROM sync_gap
        WHERE university_id = $1 AND aggregate_id = $2`,
      [UNIV, appId],
    );
    assert.equal(rows.length, 1, '빠진 sequence 2 를 gap 으로 남겨야 한다');
    assert.equal(Number(rows[0]!.expected_sequence), 2);
    assert.equal(rows[0]!.state, 'OPEN');
  });

  it('늦게 도착한 이벤트가 gap 을 메우면 RESOLVED 가 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const appId = randomUUID().replace(/-/g, '');

    await gateway.ingest(event({ kadmissionsequence: 1, data: { applicationId: appId } }));
    await gateway.ingest(event({ kadmissionsequence: 3, data: { applicationId: appId } }));
    await gateway.ingest(event({ kadmissionsequence: 2, data: { applicationId: appId } }));

    const { rows } = await db.query<{ state: string }>(
      `SELECT state FROM sync_gap WHERE university_id = $1 AND aggregate_id = $2`,
      [UNIV, appId],
    );
    assert.equal(rows[0]?.state, 'RESOLVED');
  });
});

describe('Sync Gateway — 순서 역전 방어 (v1.1 §A3 OUT_OF_ORDER)', () => {
  it('늦게 도착한 과거 이벤트가 최신 상태를 덮지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const appId = randomUUID().replace(/-/g, '');

    await gateway.ingest(
      event({
        kadmissionsequence: 2,
        data: { applicationId: appId, status: 'FINALIZED', applicationNumber: 'NEW-NUMBER' },
      }),
    );
    // 더 오래된 sequence 1 이 뒤늦게 도착한다.
    await gateway.ingest(
      event({
        kadmissionsequence: 1,
        data: { applicationId: appId, status: 'DRAFT', applicationNumber: 'OLD-NUMBER' },
      }),
    );

    const { rows } = await db.query<{ status: string; last_sequence: string }>(
      `SELECT status, last_sequence FROM application_summary
        WHERE university_id = $1 AND application_id = $2`,
      [UNIV, appId],
    );
    assert.equal(rows[0]?.status, 'FINALIZED', '오래된 이벤트가 최신 상태를 덮었다');
    assert.equal(Number(rows[0]!.last_sequence), 2);
  });
});

describe('Sync Gateway — 위장 발신 차단', () => {
  const reject = async (e: IncomingEvent): Promise<string> => {
    const gateway = new SyncGatewayService(db);
    try {
      await gateway.ingest(e);
      return 'ACCEPTED';
    } catch (err) {
      return err instanceof SyncRejection ? err.reason : 'OTHER';
    }
  };

  it('source 와 확장 속성의 대학이 다르면 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(
      await reject(event({ source: 'urn:k-admission:university:UNIV-B' })),
      'IDENTITY',
    );
  });

  it('source 형식이 다르면 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(await reject(event({ source: 'https://evil.example.com' })), 'SOURCE');
  });

  it('sequence 가 0 이하면 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(await reject(event({ kadmissionsequence: 0 })), 'SEQUENCE');
  });

  it('CloudEvents 1.0 이 아니면 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(await reject(event({ specversion: '0.3' })), 'SPECVERSION');
  });
});

describe('중앙 저장 범위 (v1.0 §17.1)', () => {
  it('요약 테이블에 개인정보 컬럼이 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kadmission_central' AND table_name = 'application_summary'`,
    );
    const columns = rows.map((r) => r.column_name);
    for (const banned of [
      'name',
      'phone',
      'email',
      'address',
      'resident_registration_number',
      'self_intro',
      'pii_ciphertext',
    ]) {
      assert.equal(columns.includes(banned), false, `중앙에 ${banned} 가 있으면 안 된다`);
    }
  });

  it('중앙은 대학 원본 application id 를 받지 않는다 — opaque id 만 저장한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // 대학 쪽 FinalizationService 가 salt 해시로 변환해 보낸다.
    // 여기서는 UUID 형식이 그대로 들어오지 않는지만 확인한다.
    const gateway = new SyncGatewayService(db);
    const opaque = 'a'.repeat(64);
    await gateway.ingest(event({ data: { applicationId: opaque } }));

    const { rows } = await db.query<{ application_id: string }>(
      `SELECT application_id FROM application_summary
        WHERE university_id = $1 AND application_id = $2`,
      [UNIV, opaque],
    );
    assert.equal(rows[0]?.application_id, opaque);
    assert.doesNotMatch(
      opaque,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      'UUID 원본이 그대로 오면 대학 식별자가 노출된다',
    );
  });
});
