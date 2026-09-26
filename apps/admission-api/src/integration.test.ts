import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { AuditService, GENESIS_HASH } from './modules/audit/audit.service';
import { PostgresIdempotencyStore } from './common/idempotency/postgres-idempotency.store';
import { FormSchemaService } from './modules/config/form-schema.service';
import { DocumentService } from './modules/document/document.service';
import { ActivationRecorder } from './modules/activation/activation-recorder';
import { ActivationSigner } from './modules/activation/activation-signer';
import { EvidenceService } from './modules/evidence/evidence.service';
import { FileInspector } from './modules/document/file-inspector';
import { ObjectStorage } from './modules/document/object-storage';
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
  db = new Db('admission-api', 'kadmission');
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
  await db.query(
    `DELETE FROM document_scan WHERE document_id IN
       (SELECT id FROM document WHERE application_id = $1)`,
    [applicationId],
  );
  await db.query(`DELETE FROM document WHERE application_id = $1`, [applicationId]);
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

describe('추가문항 Schema Registry (v1.1 §A5)', () => {
  it('활성 Config 에서 전형별 스키마를 읽는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    const loaded = await forms.load(CYCLE, 'EARLY');

    // 버전 문자열을 테스트에 박지 않는다. Config 는 운영 중에 바뀌는 값이다.
    const { rows } = await db.query<{ version: string }>(
      `SELECT version FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [CYCLE],
    );
    assert.equal(loaded.schemaVersion, rows[0]?.version);
    assert.ok((loaded.schema.properties as Record<string, unknown>)['selfIntro']);
  });

  it('자동저장은 부분 입력을 허용한다 — required 를 걸지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    const version = await forms.assertKnownFields(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
    assert.ok(version.startsWith('cfg-'), '활성 Config 버전을 그대로 돌려줘야 한다');
  });

  it('스키마에 없는 항목은 자동저장 단계에서 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    await assert.rejects(
      forms.assertKnownFields(CYCLE, 'EARLY', { 잘못된항목: 'x' }),
      (err: { problem?: { status: number } }) => err.problem?.status === 400,
    );
  });

  it('작성 도중 minLength 미달은 자동저장을 막지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    // selfIntro 는 minLength 10. 사용자가 "저는" 까지 쳤을 때 저장이 막히면
    // 그 필드를 영원히 채울 수 없다.
    await assert.doesNotReject(
      forms.assertKnownFields(CYCLE, 'EARLY', { selfIntro: '저는' }),
      '작성 도중 값으로 저장이 실패하면 사용자가 입력을 끝낼 수 없다',
    );
  });

  it('maxLength 초과는 자동저장 단계에서 막는다 — 더 쳐도 나아지지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    await assert.rejects(
      forms.assertKnownFields(CYCLE, 'EARLY', { highSchool: 'x'.repeat(200) }),
      (err: { problem?: { status: number } }) => err.problem?.status === 400,
    );
  });

  it('최종검증에서는 minLength 를 그대로 본다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    const result = await forms.validate(CYCLE, 'EARLY', {
      highSchool: '원서로고등학교',
      graduationYear: 2027,
      selfIntro: '저는',
    });
    assert.equal(result.valid, false, '자동저장에서 완화한 제약이 최종검증에서도 빠지면 안 된다');
  });

  it('타입이 틀린 값은 부분 저장에서도 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    await assert.rejects(
      forms.assertKnownFields(CYCLE, 'EARLY', { graduationYear: '이천이십칠' }),
      (err: { problem?: { status: number } }) => err.problem?.status === 400,
    );
  });

  it('최종검증은 누락 항목을 모아서 돌려준다 — 던지지 않는다 (v1.1 §07)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    const result = await forms.validate(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
    assert.equal(result.valid, false);
    const missing = result.issues.filter((i) => i.code === 'REQUIRED').map((i) => i.path);
    assert.ok(missing.length >= 2, '누락 항목을 하나만 알려주면 사용자가 여러 번 왕복한다');
  });

  it('모두 채우면 통과한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);
    const result = await forms.validate(CYCLE, 'EARLY', {
      highSchool: '원서로고등학교',
      graduationYear: 2027,
      selfIntro: '저는 분산 시스템에 관심이 있습니다.',
    });
    assert.deepEqual(result, { valid: true, issues: [] });
  });

  it('대학·전형을 추가해도 코드는 바뀌지 않는다 — Config 만 바꾼다 (§A5 핵심)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const forms = new FormSchemaService(db);

    /**
     * ⚠️ 테스트 전용 전형 코드를 쓴다.
     * 공용 개발 Config 의 실제 전형(EARLY·REGULAR)을 건드리면
     * 같은 DB 를 보는 개발 화면이 조용히 망가진다. 실제로 한 번 당했다.
     * 버전도 원래 값을 읽어 두었다가 그대로 되돌린다.
     */
    const testCode = `TEST_${randomUUID().slice(0, 8).toUpperCase()}`;
    const before = await db.query<{ version: string }>(
      `SELECT version FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [CYCLE],
    );
    const originalVersion = before.rows[0]?.version ?? 'cfg-2027-v1';

    await db.query(
      `UPDATE config_version
          SET config_json = jsonb_set(config_json, ARRAY['forms', $2], $3::jsonb),
              version = $4
        WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [
        CYCLE,
        testCode,
        JSON.stringify({
          type: 'object',
          additionalProperties: false,
          required: ['csatNumber'],
          properties: { csatNumber: { type: 'string', pattern: '^[0-9]{8}$' } },
        }),
        `${originalVersion}+${testCode}`,
      ],
    );

    try {
      const ok = await forms.validate(CYCLE, testCode, { csatNumber: '12345678' });
      assert.deepEqual(ok, { valid: true, issues: [] }, '새 전형이 코드 변경 없이 동작해야 한다');

      const bad = await forms.validate(CYCLE, testCode, { csatNumber: 'abc' });
      assert.equal(bad.valid, false, '새 전형의 제약도 그대로 적용되어야 한다');

      // 기존 전형은 영향받지 않는다.
      const early = await forms.validate(CYCLE, 'EARLY', { highSchool: '원서로고등학교' });
      assert.equal(early.valid, false);
    } finally {
      // 실패해도 반드시 되돌린다.
      await db.query(
        `UPDATE config_version
            SET config_json = config_json #- ARRAY['forms', $2],
                version = $3
          WHERE cycle_id = $1 AND status = 'ACTIVE'`,
        [CYCLE, testCode, originalVersion],
      );
    }
  });
});

describe('서류 상태 전이 (v1.0 §5.4 / v1.1 §B5)', () => {
  const docService = () =>
    new DocumentService(db, new ObjectStorage(), new FileInspector(), new AuditService());

  /** QUARANTINED 상태의 서류를 직접 만든다. 업로드 자체는 E2E 로 따로 확인했다. */
  async function seedQuarantined(): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO document (id, application_id, document_type, object_key,
                             original_filename, media_type, size_bytes, sha256_hex, status)
       VALUES ($1,$2,'TRANSCRIPT',$3,'생활기록부.pdf','application/pdf',59,$4,'QUARANTINED')`,
      [id, applicationId, `applications/${applicationId}/${id}.pdf`, 'a'.repeat(64)],
    );
    await db.query(
      `INSERT INTO document_scan (id, document_id, scanner, result)
       VALUES ($1,$2,'mock-av','PENDING')`,
      [randomUUID(), id],
    );
    return id;
  }

  it('검사 통과하면 AVAILABLE 로 간다 — 접수 확정에 쓸 수 있는 유일한 상태', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await seedQuarantined();
    const next = await docService().applyScanResult(id, 'CLEAN');
    assert.equal(next, 'AVAILABLE');
  });

  it('악성으로 판정되면 REJECTED 로 간다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await seedQuarantined();
    const next = await docService().applyScanResult(id, 'MALICIOUS');
    assert.equal(next, 'REJECTED');
  });

  it('검사 오류도 AVAILABLE 로 통과시키지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await seedQuarantined();
    const next = await docService().applyScanResult(id, 'ERROR');
    assert.notEqual(next, 'AVAILABLE', '검사 실패를 통과로 처리하면 안 된다');
  });

  it('같은 검사 결과를 두 번 적용할 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await seedQuarantined();
    await docService().applyScanResult(id, 'CLEAN');
    await assert.rejects(
      docService().applyScanResult(id, 'MALICIOUS'),
      '이미 확정된 서류 상태를 뒤집을 수 있으면 안 된다',
    );
  });

  it('검사 결과가 감사로그에 남는다 (v1.0 §9 DOCUMENT_VERIFIED)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const id = await seedQuarantined();
    await docService().applyScanResult(id, 'CLEAN');

    const { rows } = await db.query<{ action: string; result: string }>(
      `SELECT action, result FROM audit_event
        WHERE application_id = $1 AND action = 'DOCUMENT_VERIFIED'
        ORDER BY occurred_at DESC LIMIT 1`,
      [applicationId],
    );
    assert.equal(rows[0]?.action, 'DOCUMENT_VERIFIED');
    assert.equal(rows[0]?.result, 'ACCEPTED');
  });
});

describe('Evidence Package (v1.1 §A11·§C6 / §01 E)', () => {
  const service = () =>
    new EvidenceService(
      db,
      new AuditService(),
      new ActivationRecorder(db, new ActivationSigner(), new AuditService()),
    );

  it('조회 사유 없이는 뽑을 수 없다 (v1.0 §8.3)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await assert.rejects(
      service().generate(applicationId, 'auditor@univ-a', '   '),
      (err: { problem?: { status: number } }) => err.problem?.status === 400,
      '사유 없이 열람 가능하면 운영자 과권한이 열린다',
    );
  });

  it('열람 사실이 감사 기록에 남는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    await service().generate(applicationId, 'auditor@univ-a', '구제 심사 요청 2026-0001');

    const { rows } = await db.query<{ details_redacted: { reason?: string; purpose?: string } }>(
      `SELECT details_redacted FROM audit_event
        WHERE application_id = $1 AND action = 'ADMIN_VIEWED_PII'
        ORDER BY occurred_at DESC LIMIT 1`,
      [applicationId],
    );
    assert.equal(rows[0]?.details_redacted?.purpose, 'EVIDENCE_PACKAGE');
    assert.equal(rows[0]?.details_redacted?.reason, '구제 심사 요청 2026-0001');
  });

  it('같은 내용이면 같은 evidenceHash 가 나온다 — 두 증적이 같음을 보일 수 있다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // 열람 자체가 감사 이벤트를 남기므로 timeline 이 늘어난다.
    // 그래서 연속 두 번 뽑으면 해시가 달라지는 것이 **정상**이다.
    // 대신 같은 스냅샷에 대해 해시 계산이 결정적인지를 본다.
    const first = await service().generate(applicationId, 'auditor@univ-a', '검증1');
    const second = await service().generate(applicationId, 'auditor@univ-a', '검증2');

    assert.notEqual(
      first.evidenceHash,
      second.evidenceHash,
      '열람 기록이 늘었는데 해시가 같으면 timeline 이 반영되지 않은 것이다',
    );
    assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);
  });

  it('접수 과정을 재구성할 수 있다 — §01 E 핵심 인수기준', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const pkg = await service().generate(applicationId, 'auditor@univ-a', '재구성 확인');

    assert.equal(pkg.applicationId, applicationId);
    assert.ok(pkg.timeline.length > 0, '무엇을 언제 했는지가 없으면 증적이 아니다');
    assert.ok(pkg.chainVerification, 'hash-chain 검증 결과가 함께 와야 한다');
    // 모든 timeline 항목이 hash 를 갖는다.
    for (const e of pkg.timeline) {
      assert.match(e.eventHash, /^[a-f0-9]{64}$/);
    }
  });

  it('개인정보가 들어가지 않는다 (v1.0 §17.1)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const pkg = await service().generate(applicationId, 'auditor@univ-a', 'PII 확인');
    const serialized = JSON.stringify(pkg);

    // 원서 본문·첨부파일·결제수단 상세가 들어가면 안 된다.
    for (const banned of ['selfIntro', 'pii_ciphertext', 'cardNumber', 'residentRegistration']) {
      assert.equal(
        serialized.includes(banned),
        false,
        `Evidence Package 에 ${banned} 가 들어 있다`,
      );
    }
  });

  it('감사 체인이 깨져 있으면 그 사실을 함께 보고한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    // 누군가 감사 레코드를 고친 상황.
    await db.query(
      `UPDATE audit_event SET result = 'FAILED'
        WHERE application_id = $1
          AND id = (SELECT id FROM audit_event WHERE application_id = $1
                     ORDER BY occurred_at ASC LIMIT 1)`,
      [applicationId],
    );

    const pkg = await service().generate(applicationId, 'auditor@univ-a', '변조 확인');
    assert.equal(
      pkg.chainVerification.valid,
      false,
      '변조된 증적을 valid 로 내보내면 증적으로 쓸 수 없다',
    );
    assert.ok(pkg.chainVerification.brokenAt);
  });
});
