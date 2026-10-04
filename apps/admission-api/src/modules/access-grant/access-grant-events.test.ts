import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryFromEvent, reconcile, stateFromLog, type GrantEntry, type IdpAdminEvent } from './access-grant-events';

/** 권한 변경 기록 — 관리 이벤트 해석·권한 복원·대조 (G-15, D-91). 이벤트 모양은 Keycloak 26.8 실제 응답을 옮겼다 */
const ctx = { clientIdOf: (u: string) => ({ 'c-uuid': 'realm-management' })[u], defaultRole: 'default-roles-wonseoro-staff' };
const USER = '7a1c0001-0000-4000-8000-00000000a004';
const ADMIN = '57ce75c2-434f-41c4-9ae0-aec8499737b1';

const ev = (o: Partial<IdpAdminEvent>): IdpAdminEvent => ({
  id: 'e-1',
  time: 1_791_126_245_095,
  authDetails: { realmId: 'master-id', userId: ADMIN },
  operationType: 'CREATE',
  resourceType: 'REALM_ROLE_MAPPING',
  resourcePath: `users/${USER}/role-mappings/realm`,
  ...o,
});
const role = (name: string, extra: Record<string, unknown> = {}) => ({ id: `r-${name}`, name, composite: false, clientRole: false, containerId: 'realm-id', ...extra });

describe('관리 이벤트 → 권한 변경 기록', () => {
  it('렐름 역할 부여·회수 — 대상 계정·역할·바꾼 관리자, 기본 역할은 뺀다', () => {
    const add = entryFromEvent(ev({ representation: JSON.stringify([role('support-agent'), role('default-roles-wonseoro-staff')]) }), ctx);
    assert.deepEqual(
      { ...add, occurredAt: add?.occurredAt.toISOString() },
      {
        sourceEventId: 'idp:e-1',
        occurredAt: '2026-10-04T15:04:05.095Z',
        actor: ADMIN,
        details: { actorRealm: 'master-id' },
        action: 'GRANT',
        changeKind: 'ROLE_ADDED',
        subject: USER,
        roles: ['support-agent'],
      },
    );
    const del = entryFromEvent(ev({ id: 'e-2', operationType: 'DELETE', representation: JSON.stringify([role('support-agent')]) }), ctx);
    assert.equal(del?.action, 'REVOKE');
    assert.equal(del?.changeKind, 'ROLE_REMOVED');
    // 기본 역할만 바뀐 이벤트는 기록하지 않는다
    assert.equal(entryFromEvent(ev({ representation: JSON.stringify([role('default-roles-wonseoro-staff')]) }), ctx), null);
  });

  it('클라이언트 역할은 <클라이언트>:<역할> — 로그인 서버 관리 권한도 접근 권한이다', () => {
    const e = entryFromEvent(
      ev({
        resourceType: 'CLIENT_ROLE_MAPPING',
        resourcePath: `users/${USER}/role-mappings/clients/c-uuid`,
        representation: JSON.stringify([role('manage-users', { clientRole: true, containerId: 'c-uuid' })]),
      }),
      ctx,
    );
    assert.deepEqual(e?.roles, ['realm-management:manage-users']);
  });

  it('그룹 가입·탈퇴는 group:<경로>, 그룹에 준 역할은 group:<ID> 대상', () => {
    const join = entryFromEvent(
      ev({ resourceType: 'GROUP_MEMBERSHIP', resourcePath: `users/${USER}/groups/g-1`, representation: JSON.stringify({ id: 'g-1', name: '입학처', path: '/입학처' }) }),
      ctx,
    );
    assert.equal(join?.changeKind, 'GROUP_JOINED');
    assert.deepEqual(join?.roles, ['group:/입학처']);
    const groupRole = entryFromEvent(ev({ resourcePath: 'groups/g-1/role-mappings/realm', representation: JSON.stringify([role('admission-admin')]) }), ctx);
    assert.equal(groupRole?.subject, 'group:g-1');
  });

  it('계정 생성·사용 중지·삭제 — 이름·이메일은 옮기지 않는다', () => {
    const rep = JSON.stringify({ username: 'kim', firstName: '홍', lastName: '길동', email: 'kim@univ-a.test', enabled: false });
    const off = entryFromEvent(ev({ resourceType: 'USER', operationType: 'UPDATE', resourcePath: `users/${USER}`, representation: rep }), ctx);
    assert.equal(off?.changeKind, 'ACCOUNT_DISABLED');
    assert.equal(off?.action, 'REVOKE');
    assert.deepEqual(off?.details, { actorRealm: 'master-id', enabled: false });
    assert.doesNotMatch(JSON.stringify(off), /길동|kim@/);
    assert.equal(entryFromEvent(ev({ resourceType: 'USER', operationType: 'DELETE', resourcePath: `users/${USER}` }), ctx)?.changeKind, 'ACCOUNT_DELETED');
    assert.equal(entryFromEvent(ev({ resourceType: 'USER', resourcePath: `users/${USER}`, representation: rep }), ctx)?.changeKind, 'ACCOUNT_CREATED');
  });

  it('권한과 관계없는 이벤트는 버린다 — 비밀번호 재설정·OTP 삭제·클라이언트 설정·바꾼 사람 없는 이벤트', () => {
    assert.equal(entryFromEvent(ev({ resourceType: 'USER', operationType: 'ACTION', resourcePath: `users/${USER}/reset-password` }), ctx), null);
    assert.equal(entryFromEvent(ev({ resourceType: 'USER', operationType: 'DELETE', resourcePath: `users/${USER}/credentials/c1` }), ctx), null);
    assert.equal(entryFromEvent(ev({ resourceType: 'CLIENT', operationType: 'UPDATE', resourcePath: 'clients/c-uuid' }), ctx), null);
    assert.equal(entryFromEvent(ev({ authDetails: {}, representation: JSON.stringify([role('x')]) }), ctx), null);
  });

  it('역할 정의(복합 역할 구성) 변경은 CHANGE', () => {
    const e = entryFromEvent(
      ev({ resourceType: 'REALM_ROLE', resourcePath: 'roles-by-id/r-1/composites', representation: JSON.stringify([role('break-glass')]) }),
      ctx,
    );
    assert.equal(e?.changeKind, 'ROLE_DEFINITION_CHANGED');
    assert.equal(e?.subject, 'role:roles-by-id/r-1/composites');
    assert.deepEqual(e?.roles, ['break-glass']);
  });

  it('이벤트 ID 가 없으면 시각·동작·경로로 같은 키를 만든다', () => {
    const a = entryFromEvent(ev({ id: undefined, representation: JSON.stringify([role('x')]) }), ctx);
    assert.equal(a?.sourceEventId, `idp:1791126245095:CREATE:users/${USER}/role-mappings/realm`);
  });
});

describe('권한 복원과 대조', () => {
  const row = (subject: string, changeKind: GrantEntry['changeKind'], roles: string[], details: Record<string, unknown> = {}) => ({ subject, changeKind, roles, details });
  const at = new Date('2026-10-05T00:00:00Z');

  it('기준 → 부여·회수 → 사용 중지를 따라가 지금 권한을 복원한다(그룹·역할 정의 줄은 계정 상태가 아니다)', () => {
    const s = stateFromLog([
      row('a', 'BASELINE', ['admission-admin'], { enabled: true }),
      row('a', 'ROLE_ADDED', ['support-agent']),
      row('a', 'ROLE_REMOVED', ['admission-admin']),
      row('group:g', 'ROLE_ADDED', ['x']),
      row('b', 'ACCOUNT_CREATED', [], { enabled: true }),
      row('b', 'ROLE_ADDED', ['security-auditor']),
      row('b', 'ACCOUNT_DISABLED', [], { enabled: false }),
      row('c', 'BASELINE', ['sre-operator']),
      row('c', 'ACCOUNT_DELETED', []),
    ]);
    assert.deepEqual([...s.keys()].sort(), ['a', 'b']);
    assert.deepEqual([...s.get('a')!.roles], ['support-agent']);
    assert.deepEqual(s.get('b'), { roles: new Set(['security-auditor']), enabled: false });
  });

  it('기준 전의 부여·회수 이벤트만 있는 계정은 모르는 계정이다 — 대조가 기준을 남긴다(빈 권한으로 잘못 복원하지 않는다)', () => {
    const s = stateFromLog([row('v', 'ROLE_ADDED', ['support-agent']), row('v', 'ROLE_REMOVED', ['support-agent'])]);
    assert.equal(s.has('v'), false);
    const out = reconcile([{ id: 'v', username: 'viewer', enabled: true, roles: ['platform-viewer'] }], s, at);
    assert.deepEqual(out.map((e) => [e.changeKind, e.roles]), [['BASELINE', ['platform-viewer']]]);
  });

  it('처음 보는 계정은 기준, 같으면 아무것도, 다르면 대조, 사라지면 말소', () => {
    const logged = stateFromLog([row('a', 'BASELINE', ['admission-admin'], { enabled: true }), row('b', 'BASELINE', ['sre-operator'], { enabled: true }), row('gone', 'BASELINE', ['platform-viewer'])]);
    const out = reconcile(
      [
        { id: 'a', username: 'admin-a', enabled: true, roles: ['admission-admin'] },
        { id: 'b', username: 'sre', enabled: true, roles: ['break-glass', 'sre-operator'] },
        { id: 'n', username: 'new', enabled: true, roles: ['support-agent'] },
      ],
      logged,
      at,
    );
    assert.deepEqual(
      out.map((e) => [e.subject, e.action, e.changeKind, e.roles, e.details]),
      [
        ['b', 'GRANT', 'RECONCILED', ['break-glass', 'sre-operator'], { username: 'sre', enabled: true, enabledBefore: true, added: ['break-glass'], removed: [] }],
        ['n', 'BASELINE', 'BASELINE', ['support-agent'], { username: 'new', enabled: true }],
        ['gone', 'REVOKE', 'RECONCILED', [], { missing: true, removed: ['platform-viewer'] }],
      ],
    );
    assert.ok(out.every((e) => e.actor === null && e.occurredAt === at));
    // 말소 기록 뒤에는 그 계정이 상태에서 빠진다
    assert.equal(stateFromLog([row('gone', 'BASELINE', ['x']), ...out.filter((e) => e.subject === 'gone')]).has('gone'), false);
  });

  it('사용 중지만 바뀐 것도 말소(REVOKE)로 대조한다', () => {
    const out = reconcile([{ id: 'a', username: 'a', enabled: false, roles: ['x'] }], stateFromLog([row('a', 'BASELINE', ['x'], { enabled: true })]), at);
    assert.equal(out[0]?.action, 'REVOKE');
    assert.deepEqual(out[0]?.details, { username: 'a', enabled: false, enabledBefore: true, added: [], removed: [] });
  });
});
