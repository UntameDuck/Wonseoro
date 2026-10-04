import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Db } from '@wonseoro/server-kit';
import { AccessGrantCollector } from './access-grant-collector';
import { AccessGrantService } from './access-grant.module';
import type { IdpAccount, IdpAdminEvent } from './access-grant-events';
import type { IdpAdmin } from './idp-admin-client';

/**
 * 권한 변경 기록 수집 (G-15, D-91) — 실제 PostgreSQL(0011) + 가짜 로그인 서버.
 *
 * 처음 돌면 계정마다 기준 기록, 관리 이벤트로 바뀐 권한은 바꾼 관리자와 함께 한 줄, 같은 이벤트를 다시 읽어도 한 줄,
 * 이벤트 없이 바뀐 권한(관리 이벤트가 꺼져 있던 동안)은 대조 기록과 수집 실패, 체인 검증이 끊김 없이 통과하는지를 본다.
 * 실제 Keycloak 으로 같은 흐름은 `npm run test:auth:grants`.
 */
class FakeIdp implements IdpAdmin {
  readonly realm = 'wonseoro-staff';
  events: IdpAdminEvent[] = [];
  accountList: IdpAccount[] = [];
  adminEventsEnabled = true;
  async eventsConfig() {
    return { adminEventsEnabled: this.adminEventsEnabled, adminEventsDetailsEnabled: this.adminEventsEnabled };
  }
  async adminEvents(sinceMs: number | null) {
    return this.events.filter((e) => sinceMs === null || e.time >= sinceMs).sort((a, b) => a.time - b.time);
  }
  async clients() {
    return new Map([['rm-uuid', 'realm-management']]);
  }
  async accounts() {
    return this.accountList.map((a) => ({ ...a, roles: [...a.roles] }));
  }
}

let db: Db;
let available = false;
const idp = new FakeIdp();
const run = randomUUID().slice(0, 8);
const A = `it-${run}-a`;
const B = `it-${run}-b`;
const ADMIN = `it-${run}-admin`;

const rowsOf = async (subject: string) =>
  (
    await db.query<{ action: string; change_kind: string; roles: string[]; actor: string | null; details: Record<string, unknown> }>(
      `SELECT action, change_kind, roles, actor, details FROM access_grant_log WHERE subject = $1 ORDER BY seq`,
      [subject],
    )
  ).rows;

before(async () => {
  if (!process.env.DATABASE_URL) return;
  db = new Db('admission-api', 'kadmission');
  available = await db.healthy();
  if (!available) return;
  // 0011 이 없는 DB 면 건너뛰지 않고 실패한다 — 적용 목록에서 빠진 것을 숨기지 않게
  await db.query(`SELECT 1 FROM access_grant_log LIMIT 1`);
});

after(async () => {
  if (db) await db.pool.end();
});

describe('권한 변경 기록 수집 (실 DB)', () => {
  it('처음 돌면 계정마다 그 시각의 전체 권한을 기준으로 남긴다', async (t) => {
    if (!available) return t.skip('DB 없음');
    idp.accountList = [
      { id: A, username: `a-${run}`, enabled: true, roles: ['admission-admin'] },
      { id: B, username: `b-${run}`, enabled: true, roles: ['support-agent'] },
    ];
    const r = await new AccessGrantCollector(db, idp).sync();
    assert.equal(r.adminEventsEnabled, true);
    assert.deepEqual(await rowsOf(A), [
      { action: 'BASELINE', change_kind: 'BASELINE', roles: ['admission-admin'], actor: null, details: { username: `a-${run}`, enabled: true } },
    ]);
    assert.equal((await rowsOf(B)).length, 1);
  });

  it('관리 이벤트로 준 권한은 바꾼 관리자와 함께 한 줄 — 같은 이벤트를 다시 읽어도 한 줄, 대조 기록은 없다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const now = Date.now();
    idp.events.push({
      id: `ev-${run}-1`,
      time: now,
      authDetails: { realmId: 'master', userId: ADMIN },
      operationType: 'CREATE',
      resourceType: 'CLIENT_ROLE_MAPPING',
      resourcePath: `users/${A}/role-mappings/clients/rm-uuid`,
      representation: JSON.stringify([{ name: 'manage-users', clientRole: true, containerId: 'rm-uuid' }]),
    });
    idp.accountList[0]!.roles.push('realm-management:manage-users');
    const collector = new AccessGrantCollector(db, idp);
    const first = await collector.sync();
    assert.equal(first.eventsRecorded, 1);
    const again = await collector.sync();
    assert.equal(again.eventsRecorded, 0);
    const rows = await rowsOf(A);
    assert.deepEqual(rows.map((r) => [r.action, r.change_kind, r.roles, r.actor]), [
      ['BASELINE', 'BASELINE', ['admission-admin'], null],
      ['GRANT', 'ROLE_ADDED', ['realm-management:manage-users'], ADMIN],
    ]);
  });

  it('관리 이벤트가 꺼진 동안 빠진 권한은 대조 기록(빠진 역할)으로 남고 수집은 실패로 알린다', async (t) => {
    if (!available) return t.skip('DB 없음');
    idp.adminEventsEnabled = false;
    idp.accountList[1]!.roles = [];
    const r = await new AccessGrantCollector(db, idp).sync();
    assert.equal(r.adminEventsEnabled, false);
    const last = (await rowsOf(B)).at(-1);
    assert.equal(last?.change_kind, 'RECONCILED');
    assert.equal(last?.action, 'REVOKE');
    assert.deepEqual(last?.details.removed, ['support-agent']);
    idp.adminEventsEnabled = true;
  });

  it('계정 삭제 이벤트 뒤에는 대조가 그 계정을 다시 말소하지 않는다', async (t) => {
    if (!available) return t.skip('DB 없음');
    idp.events.push({
      id: `ev-${run}-2`,
      time: Date.now(),
      authDetails: { realmId: 'master', userId: ADMIN },
      operationType: 'DELETE',
      resourceType: 'USER',
      resourcePath: `users/${B}`,
    });
    idp.accountList = idp.accountList.filter((a) => a.id !== B);
    await new AccessGrantCollector(db, idp).sync();
    assert.deepEqual((await rowsOf(B)).map((r) => r.change_kind), ['BASELINE', 'RECONCILED', 'ACCOUNT_DELETED']);
  });

  it('감사자 조회 — 최신순 쪽 나눔, 로그인 이름으로 찾기, 내부 값(관리자 렐름)은 내보내지 않는다, 체인 결과 포함', async (t) => {
    if (!available) return t.skip('DB 없음');
    const svc = new AccessGrantService(db);
    const byName = await svc.list({ subject: `a-${run}`, limit: 1 });
    assert.equal(byName.items.length, 1);
    assert.equal(byName.items[0]?.subject, A);
    assert.equal(byName.items[0]?.username, `a-${run}`);
    assert.equal(byName.items[0]?.changeKind, 'ROLE_ADDED');
    assert.ok(byName.nextBefore !== null);
    const older = await svc.list({ subject: A, before: byName.nextBefore!, limit: 10 });
    assert.deepEqual(older.items.map((i) => i.changeKind), ['BASELINE']);
    assert.equal(older.nextBefore, null);
    assert.doesNotMatch(JSON.stringify(byName), /actorRealm|master/);
    const b = await svc.list({ subject: B, limit: 10 });
    assert.deepEqual(b.items.find((i) => i.changeKind === 'RECONCILED')?.removed, ['support-agent']);
    assert.equal(byName.chain.brokenSeq, null);
  });

  it('해시 체인이 처음부터 끝까지 이어진다 — 순번·해시는 DB 가 매겼다', async (t) => {
    if (!available) return t.skip('DB 없음');
    const v = await new AccessGrantCollector(db, idp).verify();
    assert.equal(v.brokenSeq, null);
    assert.ok(v.checked >= 5);
    // 앱 역할로는 고칠 수 없다
    await assert.rejects(db.query(`UPDATE access_grant_log SET roles = '{}' WHERE subject = $1`, [A]), /고치거나 지울 수 없다|permission denied/);
  });
});
