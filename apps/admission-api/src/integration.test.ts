import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from './infra/db/db.module';
import { AuditService, GENESIS_HASH } from './modules/audit/audit.service';
import { PostgresIdempotencyStore } from './common/idempotency/postgres-idempotency.store';
import { IdempotencyScope } from './common/idempotency/idempotency.store';

/**
 * 통합 테스트 — 실제 PostgreSQL 이 필요하다.
 *
 *   npm run dev:infra && npm run db:migrate
 *   DATABASE_URL=postgresql://wonseoro:wonseoro@localhost:5432/univ_a npm test -w @wonseoro/admission-api
 *
 * DB 가 없으면 전부 skip 한다. CI 의 단위 테스트 잡을 막지 않기 위함이다.
 */
const DB_URL = process.env.DATABASE_URL;

let db: Db;
let available = false;

// 테스트 전용 식별자. 기존 데이터와 섞이지 않게 매 실행 새로 만든다.
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
let applicantId: string;
let applicationId: string;

before(async () => {
  if (!DB_URL) return;
  db = new Db();
  available = await db.healthy();
  if (!available) return;

  applicantId = randomUUID();
  applicationId = randomUUID();

  await db.query(
    `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ($1, $2, '\\x00', 'v1')`,
    [applicantId, `subj-${applicantId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO application (id, cycle_id, applicant_id, admission_type_id, department_id, status)
     VALUES ($1,$2,$3,$4,$5,'DRAFT')`,
    [applicationId, CYCLE, applicantId, TYPE, DEPT],
  );
});

after(async () => {
  if (!available) return;
  // audit_event 는 application 을 지워도 CASCADE 되지 않는다.
  // 원서를 지우는 것으로 감사 기록을 없앨 수 없다는 뜻이고, 이는 의도된 설계다.
  // (v1.1 §A11 — 감사로그 삭제·수정 권한을 운영자에게 주지 않는다)
  // 테스트 데이터만 명시적으로 정리한다.
  await db.query(`DELETE FROM audit_event WHERE application_id = $1`, [applicationId]);
  await db.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
  await db.query(`DELETE FROM applicant WHERE id = $1`, [applicantId]);
  await db.onApplicationShutdown();
});

describe('감사 hash-chain (v1.0 §9 / v1.1 §A11)', () => {
  it('체인이 GENESIS 에서 시작해 순서대로 이어진다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const audit = new AuditService();

    await db.tx(async (client) => {
      await audit.record(client, {
        applicationId,
        actorType: 'APPLICANT',
        actorId: applicantId,
        action: 'APPLICATION_CREATED',
        result: 'ACCEPTED',
      });
      await audit.record(client, {
        applicationId,
        actorType: 'APPLICANT',
        actorId: applicantId,
        action: 'APPLICATION_SAVED',
        result: 'ACCEPTED',
      });
    });

    const { rows } = await db.query<{ prev_hash: string; event_hash: string; action: string }>(
      `SELECT prev_hash, event_hash, action FROM audit_event
        WHERE application_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [applicationId],
    );

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.prev_hash, GENESIS_HASH, '첫 이벤트는 GENESIS 에서 시작한다');
    assert.equal(rows[1]!.prev_hash, rows[0]!.event_hash, '두 번째는 첫 번째에 이어붙는다');
  });

  it('체인 검증이 통과한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const audit = new AuditService();
    const result = await db.tx((client) => audit.verifyChain(client, applicationId));
    assert.equal(result.valid, true);
    assert.ok(result.checked >= 2);
  });

  it('레코드를 조작하면 검증에서 드러난다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const audit = new AuditService();

    // 감사 레코드를 몰래 고치는 상황을 재현한다.
    // 운영에서는 이 UPDATE 권한 자체를 주지 않는다. (M5 WORM 저장소)
    await db.query(
      `UPDATE audit_event SET result = 'REJECTED'
        WHERE application_id = $1
          AND id = (SELECT id FROM audit_event WHERE application_id = $1
                     ORDER BY occurred_at ASC, id ASC LIMIT 1)`,
      [applicationId],
    );

    const result = await db.tx((client) => audit.verifyChain(client, applicationId));
    assert.equal(result.valid, false, '변조된 체인이 valid 로 나오면 증적으로 쓸 수 없다');
    assert.ok(result.brokenAt, '어느 레코드에서 끊겼는지 지목해야 한다');
  });

  it('원서를 지워도 감사 레코드는 FK 로 보호된다 (v1.1 §A11)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await assert.rejects(
      db.query(`DELETE FROM application WHERE id = $1`, [applicationId]),
      /foreign key constraint/i,
      '원서 삭제만으로 감사 기록이 사라지면 증적으로 쓸 수 없다',
    );
  });

  it('IP 는 원문이 아니라 해시로 저장된다 (v1.0 §9)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const audit = new AuditService();
    await db.tx(async (client) => {
      await audit.record(client, {
        applicationId,
        actorType: 'APPLICANT',
        actorId: applicantId,
        action: 'LOGIN_SUCCEEDED',
        result: 'ACCEPTED',
        sourceIp: '203.0.113.45',
      });
    });

    const { rows } = await db.query<{ source_ip_hash: string | null }>(
      `SELECT source_ip_hash FROM audit_event
        WHERE application_id = $1 AND action = 'LOGIN_SUCCEEDED'`,
      [applicationId],
    );
    const hash = rows[0]?.source_ip_hash;
    assert.ok(hash);
    assert.equal(hash.includes('203.0.113.45'), false, 'IP 원문이 저장되었다');
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

describe('Postgres Idempotency Store', () => {
  const scopeFor = (key: string): IdempotencyScope => ({
    applicationId,
    operation: 'POST:finalize',
    key,
  });

  it('동시 100건 중 정확히 1건만 선점한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const scope = scopeFor(`concurrent-${randomUUID()}`);

    const results = await Promise.all(
      Array.from({ length: 100 }, () => store.acquire(scope, 'same-hash')),
    );

    const acquired = results.filter((r) => r === null).length;
    assert.equal(acquired, 1, 'INSERT ... ON CONFLICT 로 선점은 1건이어야 한다');
    assert.equal(results.length - acquired, 99);
  });

  it('완료 응답을 재생한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const scope = scopeFor(`replay-${randomUUID()}`);

    assert.equal(await store.acquire(scope, 'h'), null);
    await store.complete(scope, 201, { applicationNumber: '2027-A-000777' });

    const replay = await store.acquire(scope, 'h');
    assert.ok(replay);
    assert.equal(replay.state, 'COMPLETED');
    assert.equal(replay.responseStatus, 201);
    assert.deepEqual(replay.responseBody, { applicationNumber: '2027-A-000777' });
  });

  it('실패는 FAILED 로 남는다 — 삭제하지 않는다 (D-11)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const scope = scopeFor(`failed-${randomUUID()}`);

    await store.acquire(scope, 'h');
    await store.fail(scope);

    const after = await store.acquire(scope, 'h');
    assert.ok(after);
    assert.equal(after.state, 'FAILED');
  });

  it('같은 키라도 operation 이 다르면 간섭하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const store = new PostgresIdempotencyStore(db);
    const key = `shared-${randomUUID()}`;

    assert.equal(await store.acquire({ applicationId, operation: 'op-a', key }, 'h'), null);
    assert.equal(await store.acquire({ applicationId, operation: 'op-b', key }, 'h'), null);
  });
});
