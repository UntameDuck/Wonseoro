import assert from 'node:assert/strict';
import { COMMON_PROFILE_COLLECTION_CONSENT } from '@wonseoro/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Db, LocalKeyRing, purposeRef, useFieldKeyRing } from '@wonseoro/server-kit';
import {
  IncomingEvent,
  SyncGatewayService,
  SyncRejection,
} from './modules/sync-gateway/sync-gateway.service';
import { ApplicantProfileController } from './modules/profile-vault/profile-vault.controller';
import { ProfileRejection, ProfileVaultService } from './modules/profile-vault/profile-vault.service';

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
  await db.query(`DELETE FROM kadmission_vault.profile_snapshot_log WHERE subject_token LIKE 'subj-test-%'`);
  await db.query(`DELETE FROM kadmission_vault.profile_release_consent WHERE subject_token LIKE 'subj-test-%'`);
  await db.query(`DELETE FROM kadmission_vault.applicant_profile WHERE subject_token LIKE 'subj-test-%'`);
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

  it('등록되지 않은 대학의 이벤트는 400 으로 거부한다 — 전에는 외래키 오류 500 이라 Relay 가 계속 재시도했다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(
      await reject(event({ source: 'urn:k-admission:university:UNIV-NOPE', kadmissionuniversity: 'UNIV-NOPE' })),
      'UNKNOWN_UNIVERSITY',
    );
  });
});

describe('대학 심장박동 (§04 sync.heartbeat, D-60)', () => {
  const beat = (data: Record<string, unknown>): IncomingEvent => ({
    specversion: '1.0',
    id: randomUUID(),
    source: SOURCE,
    type: 'kr.kadmission.sync.heartbeat.v1',
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    kadmissionuniversity: UNIV,
    kadmissionsequence: Math.floor(Date.now() / 1000),
    data: {
      universityId: UNIV,
      platformVersion: 'test-1.4.0',
      configVersion: 'cfg-hb',
      pendingOutbox: 3,
      oldestPendingAgeSeconds: 42,
      clockOffsetMs: -12,
      ...data,
    },
  });

  it('심장박동이 대학의 지금 상태를 덮어쓰고, 원서 원장·gap 에는 남지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const result = await gateway.ingest(beat({}));
    assert.match(result.receiptId, /^HB-/);

    const status = (await gateway.syncStatus()).find((u) => u.universityId === UNIV);
    assert.equal(status?.reachable, true);
    assert.equal(status?.pendingOutbox, 3);
    assert.equal(status?.oldestPendingAgeSeconds, 42);
    assert.equal(status?.clockOffsetMs, -12);
    assert.equal(status?.configVersion, 'cfg-hb');
    assert.equal(status?.platformVersion, 'test-1.4.0');

    const ledger = await db.query(
      `SELECT 1 FROM received_event WHERE university_id = $1 AND event_type = 'kr.kadmission.sync.heartbeat.v1'`,
      [UNIV],
    );
    assert.equal(ledger.rows.length, 0);
  });

  it('스키마와 다른 심장박동은 거부한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    await assert.rejects(gateway.ingest(beat({ pendingOutbox: -1 })), (err: unknown) => err instanceof SyncRejection);
    await assert.rejects(gateway.ingest(beat({ universityId: 'UNIV-OTHER' })), (err: unknown) => err instanceof SyncRejection);
  });

  it('심장박동이 끊긴 대학은 "확인 불가" 다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    await gateway.ingest(beat({}));
    await db.query(
      `UPDATE university_sync_state SET last_heartbeat_at = now() - interval '1 hour' WHERE university_id = $1`,
      [UNIV],
    );
    const status = (await gateway.syncStatus()).find((u) => u.universityId === UNIV);
    assert.equal(status?.reachable, false);
  });
});

describe('중앙 저장 범위 (v1.0 §17.1)', () => {
  it('키버전 HMAC subjectRef를 요약에 보존한다 (D-39·D-46)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const appId = randomUUID().replace(/-/g, '');
    const ref = purposeRef(
      'DASHBOARD',
      { id: 'k1', secret: 'dashboard-secret-for-sync-test' },
      `subj-test-${randomUUID()}`,
    );

    await gateway.ingest(event({ data: { applicationId: appId, subjectRef: ref } }));

    const { rows } = await db.query<{ subject_ref: string | null }>(
      `SELECT subject_ref FROM application_summary
        WHERE university_id = $1 AND application_id = $2`,
      [UNIV, appId],
    );
    assert.equal(rows[0]?.subject_ref, ref);
  });

  it('전형·모집단위 표시 이름을 저장하고, 이름 없는 뒤 알림이 지우지 않는다 (T-M5-51)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const gateway = new SyncGatewayService(db);
    const appId = randomUUID().replace(/-/g, '');
    await gateway.ingest(
      event({ data: { applicationId: appId, admissionTypeName: '학생부종합전형', departmentName: '컴퓨터공학과' } }),
    );
    // 이름이 없는 옛 대학의 뒤 알림 — 있던 이름을 지우지 않는다
    await gateway.ingest(event({ kadmissionsequence: 2, data: { applicationId: appId } }));

    const { rows } = await db.query<{ admission_type_name: string | null; department_name: string | null; last_sequence: string }>(
      `SELECT admission_type_name, department_name, last_sequence FROM application_summary
        WHERE university_id = $1 AND application_id = $2`,
      [UNIV, appId],
    );
    assert.equal(Number(rows[0]?.last_sequence), 2);
    assert.equal(rows[0]?.admission_type_name, '학생부종합전형');
    assert.equal(rows[0]?.department_name, '컴퓨터공학과');
  });

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

describe('Common Profile Vault — 목적 최소화 (v1.0 §17, v1.1 §10 §3)', () => {
  const token = () => `subj-test-${randomUUID().slice(0, 8)}`;

  it('동의한 필드만 내보낸다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    const subject = token();

    await vault.replaceProfile(
      subject,
      { highSchool: '원서로고등학교', graduationYear: 2027, contactEmail: 'me@example.kr', phone: '010-0000-0000' },
      [{ universityId: UNIV, fieldCodes: ['highSchool', 'graduationYear'] }],
    );

    const result = await vault.release({
      subjectToken: subject,
      universityId: UNIV,
      requestedFields: ['highSchool', 'graduationYear', 'contactEmail', 'phone'],
    });

    assert.deepEqual(result.releasedFields.sort(), ['graduationYear', 'highSchool']);
    assert.equal('contactEmail' in result.fields, false, '동의 없는 필드가 나갔다');
    assert.equal('phone' in result.fields, false, '동의 없는 필드가 나갔다');
  });

  it('막힌 필드를 숨기지 않고 알려준다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    const subject = token();

    await vault.replaceProfile(subject, { highSchool: 'X', contactEmail: 'a@b.kr' }, [
      { universityId: UNIV, fieldCodes: ['highSchool'] },
    ]);

    const result = await vault.release({
      subjectToken: subject,
      universityId: UNIV,
      requestedFields: ['highSchool', 'contactEmail'],
    });
    // 대학이 "왜 비어 있지"를 추측하게 두면 안 된다.
    assert.deepEqual(result.withheldFields, ['contactEmail']);
  });

  it('동의가 아예 없으면 아무것도 내보내지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    const subject = token();
    await vault.replaceProfile(subject, { highSchool: 'X' }, []);

    const result = await vault.release({
      subjectToken: subject,
      universityId: UNIV,
      requestedFields: ['highSchool'],
    });
    assert.deepEqual(result.fields, {});
    assert.deepEqual(result.withheldFields, ['highSchool']);
  });

  it('발급 증적에 값이 아니라 필드 코드만 남는다 (v1.0 §8.3)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    const subject = token();

    await vault.replaceProfile(subject, { highSchool: '원서로고등학교' }, [
      { universityId: UNIV, fieldCodes: ['highSchool'] },
    ]);
    await vault.release({
      subjectToken: subject,
      universityId: UNIV,
      requestedFields: ['highSchool'],
    });

    const { rows } = await db.query<{ released_fields: string[] }>(
      `SELECT released_fields FROM kadmission_vault.profile_snapshot_log
        WHERE subject_token = $1`,
      [subject],
    );
    assert.deepEqual(rows[0]?.released_fields, ['highSchool']);

    // 로그 테이블 어디에도 값 컬럼이 없어야 한다.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kadmission_vault' AND table_name = 'profile_snapshot_log'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    assert.equal(names.includes('values'), false);
    assert.equal(names.includes('fields'), false);
  });

  it('동의 목록에서 뺀 대학은 철회된다 — 지우지 않고 철회 시각을 남긴다 (D-57)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    const subject = token();
    await vault.replaceProfile(subject, { highSchool: 'X' }, [{ universityId: UNIV, fieldCodes: ['highSchool'] }]);
    const granted = await vault.profileOf(subject);
    assert.equal(granted.consents[0]?.universityName, '테스트대학교', '화면은 대학 id 대신 이름을 보인다 (T-M5-51)');
    const saved = await vault.replaceProfile(subject, { highSchool: 'X' }, []);
    assert.deepEqual(saved.consents, []);

    const released = await vault.release({ subjectToken: subject, universityId: UNIV, requestedFields: ['highSchool'] });
    assert.deepEqual(released.withheldFields, ['highSchool'], '철회 뒤에는 나가지 않는다');
    const { rows } = await db.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM kadmission_vault.profile_release_consent WHERE subject_token = $1`,
      [subject],
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.revoked_at, '동의 기록은 남고 철회 시각이 찍힌다');
  });

  it('저장하지 않은 항목의 제공 동의·잘못된 항목은 거절한다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const vault = new ProfileVaultService(db);
    await assert.rejects(
      vault.replaceProfile(token(), { highSchool: 'X' }, [{ universityId: UNIV, fieldCodes: ['phone'] }]),
      (err: unknown) => err instanceof ProfileRejection,
    );
    await assert.rejects(
      vault.replaceProfile(token(), { selfIntro: '공통원서 표준에 없는 항목' }, []),
      (err: unknown) => err instanceof ProfileRejection,
    );
    await assert.rejects(
      vault.replaceProfile(token(), { contactEmail: 'not-an-email' }, []),
      (err: unknown) => err instanceof ProfileRejection,
    );
    await assert.rejects(
      vault.replaceProfile(token(), { highSchool: { nested: 1 } }, []),
      (err: unknown) => err instanceof ProfileRejection,
    );
  });

  it('지원자용 API 는 헤더의 신원으로만 읽고 쓴다 — 신원이 없으면 400', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const controller = new ApplicantProfileController(new ProfileVaultService(db));
    const subject = token();
    // 공통원서 수집·이용 동의 판이 없으면 저장하지 않는다 (G-3, D-82)
    await assert.rejects(controller.replace({ fields: { contactEmail: 'me@example.kr' }, consents: [] }, subject), (e: unknown) => (e as { getStatus?: () => number }).getStatus?.() === 400);
    await controller.replace({ fields: { contactEmail: 'me@example.kr' }, consents: [], collectionConsentVersion: COMMON_PROFILE_COLLECTION_CONSENT.version }, subject);
    // 지원자는 공통원서를 지울 수 있다 — 값·제공 동의가 사라지고, 다시 지워도 같은 결과 (G-10, D-82)
    assert.deepEqual(await controller.remove(subject), { deleted: true });
    assert.deepEqual((await controller.get(subject)).fields, {});
    assert.deepEqual(await controller.remove(subject), { deleted: false });
    await controller.replace({ fields: { contactEmail: 'me@example.kr' }, consents: [], collectionConsentVersion: COMMON_PROFILE_COLLECTION_CONSENT.version }, subject);
    const mine = await controller.get(subject);
    assert.deepEqual(mine.fields, { contactEmail: 'me@example.kr' });
    assert.ok(mine.updatedAt);
    await assert.rejects(controller.get(undefined), (err: unknown) => (err as { getStatus?: () => number }).getStatus?.() === 400);
  });

  it('Vault 는 집계 DB 와 다른 스키마에 있다 (v1.0 §5·§8.3)', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const { rows } = await db.query<{ table_schema: string }>(
      `SELECT DISTINCT table_schema FROM information_schema.tables
        WHERE table_name IN ('applicant_profile', 'application_summary')`,
    );
    const schemas = rows.map((r) => r.table_schema).sort();
    assert.deepEqual(
      schemas,
      ['kadmission_central', 'kadmission_vault'],
      '공통원서 Vault 와 집계 DB 가 같은 스키마에 있으면 개인정보가 한곳에 집중된다',
    );
  });
});

describe('공통원서 금고 암호화 (T-M5-06, 0004)', () => {
  const token = () => `subj-test-${randomUUID().slice(0, 8)}`;
  const k1 = { id: 'it-k1', key: randomBytes(32) };
  const k2 = { id: 'it-k2', key: randomBytes(32) };
  after(() => useFieldKeyRing(null));

  it('저장한 공통원서는 DB 에 평문이 없고, 지원자·대학에는 그대로 나간다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    useFieldKeyRing(new LocalKeyRing([k1]));
    const vault = new ProfileVaultService(db);
    const subject = token();
    await vault.replaceProfile(subject, { highSchool: '비밀고등학교', phone: '010-9999-0000' }, [{ universityId: UNIV, fieldCodes: ['phone'] }]);

    const raw = await db.query<{ row: string; key_version: string }>(
      `SELECT t::text AS row, key_version FROM kadmission_vault.applicant_profile t WHERE subject_token = $1`,
      [subject],
    );
    assert.equal(raw.rows[0]?.key_version, 'it-k1');
    assert.equal(raw.rows[0]?.row.includes('010-9999-0000'), false, '행 전체를 글자로 떠도 평문이 없다');
    assert.equal(raw.rows[0]?.row.includes('비밀'), false);

    assert.equal((await vault.profileOf(subject)).fields.highSchool, '비밀고등학교');
    const snap = await vault.release({ subjectToken: subject, universityId: UNIV, requestedFields: ['phone', 'highSchool'] });
    assert.deepEqual(snap.fields, { phone: '010-9999-0000' });
  });

  it('KEK 교체 뒤 옛 공통원서가 읽히고, rewrap 뒤 옛 KEK 없이도 읽힌다 · 키가 없으면 503', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    useFieldKeyRing(new LocalKeyRing([k1]));
    const vault = new ProfileVaultService(db);
    const subject = token();
    await vault.replaceProfile(subject, { contactEmail: 'me@example.kr' }, []);

    useFieldKeyRing(new LocalKeyRing([k2, k1]));
    assert.equal((await vault.profileOf(subject)).fields.contactEmail, 'me@example.kr');
    let moved = 0;
    for (let n = -1; n !== 0; moved += n) n = await vault.rewrapKeys('it-k1');
    assert.ok(moved >= 1);
    useFieldKeyRing(new LocalKeyRing([k2]));
    assert.equal((await vault.profileOf(subject)).fields.contactEmail, 'me@example.kr');

    useFieldKeyRing(new LocalKeyRing([{ id: 'it-other', key: randomBytes(32) }]));
    await assert.rejects(vault.profileOf(subject), (e: unknown) => e instanceof HttpException && e.getStatus() === 503);
  });

  it('0004 이전 평문 공통원서 — 읽히고, encrypt-legacy 가 옮긴다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    useFieldKeyRing(new LocalKeyRing([k2]));
    const vault = new ProfileVaultService(db);
    const subject = token();
    await db.query(`INSERT INTO kadmission_vault.applicant_profile (subject_token, fields) VALUES ($1, $2)`, [
      subject,
      JSON.stringify({ highSchool: '옛평문고' }),
    ]);
    assert.equal((await vault.profileOf(subject)).fields.highSchool, '옛평문고');
    let moved = 0;
    for (let n = -1; n !== 0; moved += n) n = await vault.encryptLegacy();
    assert.ok(moved >= 1);
    const raw = await db.query<{ key_version: string; fields: unknown }>(
      `SELECT key_version, fields FROM kadmission_vault.applicant_profile WHERE subject_token = $1`,
      [subject],
    );
    assert.equal(raw.rows[0]?.key_version, 'it-k2');
    assert.deepEqual(raw.rows[0]?.fields, {});
    assert.equal((await vault.profileOf(subject)).fields.highSchool, '옛평문고');
  });
});
