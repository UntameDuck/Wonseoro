import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { configureEgress } from '@wonseoro/server-kit';
import { IdpAdminError, KeycloakAdmin } from './idp-admin-client';

/**
 * 로그인 서버 관리 API 읽기 (G-15, D-91) — 가짜 관리 API 서버로. 실제 Keycloak 은 `npm run test:auth:grants`.
 * 주소 해석(앞 경로 포함)·토큰 재사용·쪽 나눔·서비스 계정 합치기·기본 역할 제외·없는 서비스 계정(404)을 본다.
 */
let server: Server;
let base = '';
const calls: string[] = [];
let tokens = 0;

const USERS = [
  { id: 'u1', username: 'admin-a', enabled: true },
  { id: 'u2', username: 'viewer', enabled: false },
  { id: 'u3', username: 'auditor', enabled: true },
];

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const p = url.pathname.replace('/auth', '');
    if (p === '/realms/staff/protocol/openid-connect/token') {
      tokens++;
      return json(200, { access_token: `t${tokens}`, expires_in: 300 });
    }
    if (req.headers.authorization !== `Bearer t${tokens}`) return json(401, {});
    const A = '/admin/realms/staff/';
    if (p === `${A}users`) {
      const first = Number(url.searchParams.get('first'));
      const max = Number(url.searchParams.get('max'));
      return json(200, USERS.slice(first, first + max));
    }
    if (p === `${A}clients`) return json(200, [{ id: 'c-col', clientId: 'access-grant-collector' }, { id: 'c-web', clientId: 'admin-web' }]);
    if (p === `${A}clients/c-col/service-account-user`) return json(200, { id: 'sa1', username: 'service-account-access-grant-collector', enabled: true });
    if (p === `${A}clients/c-web/service-account-user`) return json(404, {});
    const m = /users\/(\w+)\/(role-mappings|groups)$/.exec(p);
    if (m?.[2] === 'groups') return json(200, m[1] === 'u3' ? [{ name: '감사', path: '/감사' }] : []);
    if (m?.[2] === 'role-mappings') {
      if (m[1] === 'sa1') return json(200, { clientMappings: { 'realm-management': { client: 'realm-management', mappings: [{ name: 'view-events' }] } } });
      return json(200, { realmMappings: [{ name: 'default-roles-staff' }, { name: m[1] === 'u1' ? 'admission-admin' : 'platform-viewer' }] });
    }
    if (p === `${A}admin-events`) {
      const from = Number(url.searchParams.get('dateFrom') ?? 0);
      const type = url.searchParams.get('resourceTypes');
      const all = [
        { id: 'e2', time: 2000, operationType: 'DELETE', resourceType: 'REALM_ROLE_MAPPING' },
        { id: 'e1', time: 1000, operationType: 'CREATE', resourceType: 'REALM_ROLE_MAPPING' },
      ];
      return json(200, all.filter((e) => e.resourceType === type && e.time >= from));
    }
    return json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  configureEgress([base]);
});

after(() => new Promise<void>((r) => server.close(() => r())));

describe('로그인 서버 관리 API 읽기', () => {
  it('발급자 주소가 …/realms/<렐름> 이 아니면 거절한다', () => {
    assert.throws(() => new KeycloakAdmin({ issuer: `${base}/somewhere`, clientId: 'c', clientSecret: 's' }), IdpAdminError);
  });

  it('앞 경로(/auth)가 있는 발급자 — 계정·서비스 계정·역할·그룹, 기본 역할은 빼고 토큰은 한 번만 받는다', async () => {
    const idp = new KeycloakAdmin({ issuer: `${base}/auth/realms/staff`, clientId: 'access-grant-collector', clientSecret: 's', pageSize: 2 });
    assert.equal(idp.realm, 'staff');
    const accounts = await idp.accounts();
    assert.deepEqual(
      accounts.map((a) => [a.username, a.enabled, a.roles]),
      [
        ['admin-a', true, ['admission-admin']],
        ['viewer', false, ['platform-viewer']],
        ['auditor', true, ['group:/감사', 'platform-viewer']],
        ['service-account-access-grant-collector', true, ['realm-management:view-events']],
      ],
    );
    assert.equal(tokens, 1, '토큰은 만료 전까지 다시 쓴다');
    // 쪽 크기 2 — 두 쪽을 받는다
    assert.deepEqual(calls.filter((c) => c.includes('/users?')).map((c) => new URL(c.split(' ')[1]!, 'http://x').searchParams.get('first')), ['0', '2']);
    assert.ok(calls.some((c) => c.startsWith('GET /auth/admin/realms/staff/')), '앞 경로를 지킨다');
  });

  it('관리 이벤트는 밀리초 dateFrom 으로 거르고 시각 오름차순으로 돌려준다', async () => {
    const idp = new KeycloakAdmin({ issuer: `${base}/realms/staff`, clientId: 'c', clientSecret: 's' });
    assert.deepEqual((await idp.adminEvents(null)).map((e) => e.id), ['e1', 'e2']);
    assert.deepEqual((await idp.adminEvents(1500)).map((e) => e.id), ['e2']);
  });
});
