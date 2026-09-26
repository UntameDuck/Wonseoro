import assert from 'node:assert/strict';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { ActivationRecorder } from '../activation/activation-recorder';
import { ActivationSigner, canonicalJson } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
import { DeadlinePolicyRepository } from './deadline-policy.repository';

/**
 * 마감 연장 + 서명된 활성화 기록 통합 테스트 — 실제 PostgreSQL 이 필요하다. (T-M3-14·15, §B17)
 *
 * 전형은 테스트마다 따로 만든다. 끝나면 **지우지 않고 닫는다** — 활성화 기록은 추가만
 * 가능하고 전형을 참조하므로, 적용 이력이 있는 전형은 지울 수 없어야 맞다.
 */
let db: Db;
let available = false;
const cycles: string[] = [];
const HOUR = 3_600_000;

const signer = () => new ActivationSigner();
const recorder = () => new ActivationRecorder(db, signer(), new AuditService());
const repo = () => new DeadlinePolicyRepository(db, recorder());

async function makeCycle(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO admission_cycle (id, university_id, admission_year, name, opens_at, closes_at, status)
     VALUES ($1, 'UNIV-A', 2099, $2, now(), now() + interval '90 days', 'OPEN')`,
    // 전형은 지우지 않고 닫으므로 이름이 겹치지 않게 한다. (이름이 유니크다)
    [id, `연장 검증용 ${id.slice(0, 8)}`],
  );
  cycles.push(id);
  return id;
}

/** 기준 정책을 적용해 둔다. 마감 1시간 전 — 설정 잠금(Freeze) 구간 안이다. */
async function seedBase(cycleId: string, version = 'base-v1', inMs = HOUR): Promise<string> {
  const r = repo();
  const { policyId } = await r.createDraft({
    cycleId,
    version,
    mode: 'FINALIZED_COMMIT_BEFORE_DEADLINE',
    deadlineAt: new Date(Date.now() + inMs).toISOString(),
    createdBy: 'officer1@univ-a',
  });
  await r.approve(policyId, 'officer2@univ-a');
  await r.approve(policyId, 'officer3@univ-a');
  await r.activate(policyId, null, 'officer2@univ-a');
  return policyId;
}

async function approveTwice(policyId: string): Promise<void> {
  await repo().approve(policyId, 'officer2@univ-a');
  await repo().approve(policyId, 'officer3@univ-a');
}

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (err instanceof ProblemException) return err.getStatus();
    throw err;
  }
}

const extension = (cycleId: string, over: Partial<{ deadlineAt: string; reason: string; decisionRef: string }> = {}) =>
  repo().createExtension({
    cycleId,
    deadlineAt: new Date(Date.now() + 3 * HOUR).toISOString(),
    reason: '접수 서버 장애로 40분간 제출 불가',
    decisionRef: '입학처-2026-117',
    createdBy: 'officer1@univ-a',
    ...over,
  });

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
});

after(async () => {
  if (!available) return;
  for (const id of cycles) {
    await db.query(`UPDATE admission_cycle SET status = 'ARCHIVED' WHERE id = $1`, [id]);
  }
  await db.onApplicationShutdown();
});

describe('마감 연장은 입학처의 결정을 집행한다 (v1.1 §B17)', () => {
  it('결정 문서번호나 사유가 없으면 연장을 만들 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);
    assert.equal(await status(extension(cycleId, { decisionRef: '' })), 400);
    assert.equal(await status(extension(cycleId, { decisionRef: '   ' })), 400);
    assert.equal(await status(extension(cycleId, { reason: '장애' })), 400);
  });

  it('마감을 앞당기는 것은 연장이 아니다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);
    const earlier = new Date(Date.now() + HOUR / 2).toISOString();
    assert.equal(await status(extension(cycleId, { deadlineAt: earlier })), 400);
  });

  it('적용 중인 정책이 없으면 연장할 기준이 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    assert.equal(await status(extension(await makeCycle())), 400);
  });

  it('마감 직전에도 연장된다 — 2인 승인, 서명된 기록, 새 마감 적용', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);

    const ext = await extension(cycleId);
    assert.equal(ext.version, 'base-v1-ext1');
    assert.equal(ext.extendsVersion, 'base-v1');

    // 작성자는 자기 연장을 승인할 수 없다. 두 명이 필요하다.
    assert.equal(await status(repo().approve(ext.policyId, 'officer1@univ-a')), 403);
    await repo().approve(ext.policyId, 'officer2@univ-a');
    assert.equal(await status(repo().activate(ext.policyId, null, 'officer2@univ-a')), 403);
    await repo().approve(ext.policyId, 'officer3@univ-a');

    // 마감 1시간 전 — 설정 잠금 구간이지만 연장은 막히지 않는다.
    const { activation } = await repo().activate(ext.policyId, null, 'officer3@univ-a');
    assert.equal(activation.kind, 'EXTEND');
    assert.equal(activation.decisionRef, '입학처-2026-117');
    assert.equal(activation.reason, '접수 서버 장애로 40분간 제출 불가');
    assert.equal(activation.supersedesVersion, 'base-v1');
    assert.equal(activation.operatorId, 'officer3@univ-a');
    assert.deepEqual(activation.content.approvedBy, ['officer2@univ-a', 'officer3@univ-a']);
    assert.ok(activation.content.previousDeadlineAt, '무엇을 무엇으로 바꿨는지 함께 서명한다');

    const current = await repo().current(cycleId);
    assert.equal(current.version, 'base-v1-ext1');

    const history = await repo().activationHistory(cycleId);
    assert.deepEqual(
      history.map((h) => [h.subjectVersion, h.kind, h.signature]),
      [
        ['base-v1', 'ACTIVATE', 'VALID'],
        ['base-v1-ext1', 'EXTEND', 'VALID'],
      ],
    );
  });

  it('승인하는 사이 기준이 바뀌었으면 연장을 적용하지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);

    // 같은 기준에서 두 연장이 만들어졌다. 먼저 적용된 쪽이 기준을 바꾼다.
    const first = await extension(cycleId);
    const second = await extension(cycleId, {
      deadlineAt: new Date(Date.now() + 5 * HOUR).toISOString(),
    });
    assert.equal(second.version, 'base-v1-ext2');
    await approveTwice(first.policyId);
    await approveTwice(second.policyId);
    await repo().activate(first.policyId, null, 'officer2@univ-a');

    // 두 번째 승인자들이 본 "현재 마감" 은 이제 현재가 아니다.
    assert.equal(await status(repo().activate(second.policyId, null, 'officer2@univ-a')), 409);
    assert.equal((await repo().current(cycleId)).version, 'base-v1-ext1');
  });

  it('한 번 적용된 정책은 다시 적용하지 않는다 — 옛 마감으로 돌아가는 뒷문이 된다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    const baseId = await seedBase(cycleId);
    assert.equal(await status(repo().activate(baseId, null, 'officer2@univ-a')), 400);
  });

  it('적용 시각에 이미 지난 마감은 적용하지 않고, 기록도 남지 않는다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    const { policyId } = await repo().createDraft({
      cycleId,
      version: 'past-v1',
      mode: 'FINALIZED_COMMIT_BEFORE_DEADLINE',
      deadlineAt: new Date(Date.now() - HOUR).toISOString(),
      createdBy: 'officer1@univ-a',
    });
    await approveTwice(policyId);
    assert.equal(await status(repo().activate(policyId, null, 'officer2@univ-a')), 400);

    // 트랜잭션이 통째로 되돌아가야 한다. 적용 표시만 남거나 기록만 남으면 안 된다.
    const { rows } = await db.query<{ activated_at: Date | null }>(
      `SELECT activated_at FROM deadline_policy WHERE id = $1`,
      [policyId],
    );
    assert.equal(rows[0]?.activated_at, null);
    assert.equal((await repo().activationHistory(cycleId)).length, 0);
  });
});

describe('서명된 활성화 기록 (T-M3-15)', () => {
  it('기록은 고치거나 지울 수 없다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);
    await assert.rejects(
      db.query(`UPDATE activation_record SET reason = '조작' WHERE cycle_id = $1`, [cycleId]),
      /추가만 가능하다/,
    );
    await assert.rejects(
      db.query(`DELETE FROM activation_record WHERE cycle_id = $1`, [cycleId]),
      /추가만 가능하다/,
    );
  });

  it('대학 밖에서 공개키만으로 검증할 수 있다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);
    const { rows } = await db.query<{ payload: Record<string, unknown>; signature: string }>(
      `SELECT payload, signature FROM activation_record WHERE cycle_id = $1`,
      [cycleId],
    );

    // 이 대학의 코드도 DB 도 없이, 공개키와 기록만 있으면 된다.
    const [key] = signer().publicKeys();
    const ok = edVerify(
      null,
      Buffer.from(canonicalJson(rows[0]!.payload), 'utf8'),
      createPublicKey(key!.publicKeyPem),
      Buffer.from(rows[0]!.signature, 'base64'),
    );
    assert.equal(ok, true);

    // 한 글자만 바꿔도 검증에 실패한다.
    const forged = { ...rows[0]!.payload, operatorId: 'someone-else' };
    const forgedOk = edVerify(
      null,
      Buffer.from(canonicalJson(forged), 'utf8'),
      createPublicKey(key!.publicKeyPem),
      Buffer.from(rows[0]!.signature, 'base64'),
    );
    assert.equal(forgedOk, false);
  });

  it('활성화마다 운영자 감사 체인에 이어 붙고, 체인이 온전하다', async (t) => {
    if (!available) return t.skip('DATABASE_URL 없음');
    const cycleId = await makeCycle();
    await seedBase(cycleId);
    const [activation] = await repo().activationHistory(cycleId);

    const { rows } = await db.query<{ prev_hash: string }>(
      `SELECT prev_hash FROM audit_event
        WHERE application_id IS NULL AND details_redacted->>'activationId' = $1`,
      [activation!.activationId],
    );
    assert.equal(rows.length, 1);
    // 원서 없는 이벤트도 체인이다. 전에는 전부 GENESIS 에서 시작했다. (D-36)
    const chain = await recorder().verifySystemChain();
    assert.equal(chain.valid, true, `시스템 체인이 끊겼다: ${chain.brokenAt}`);
    assert.ok(chain.checked >= 1);
  });
});
