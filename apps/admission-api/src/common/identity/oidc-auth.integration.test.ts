import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { Db } from '@wonseoro/server-kit';

/**
 * OIDC 인증 HTTP 시험 — 실제 AppModule·실제 훅 순서(app.setup.ts)·실제 PostgreSQL (T-M5-02·10 단계 3)
 *
 * 발급자는 이 시험이 띄우는 작은 HTTP 서버다(렐름 둘, 서로 다른 키). 토큰은 시험이 서명한다 —
 * Keycloak 이 실제로 이런 토큰을 주는지는 tests/auth/local-issuer.mjs 가 본다.
 *   - 토큰 없이 되는 경로·안 되는 경로가 계약대로
 *   - 처음 온 지원자는 등록되고, 남의 원서는 토큰을 바꿔도 헤더를 꾸며도 못 본다(BOLA)
 *   - 렐름이 섞이지 않는다(담당자 토큰 → 지원자 API, 지원자 토큰 → 운영 API)
 *   - 위조·만료 토큰 거절, 역할별 운영 API(수직 권한), 비밀번호만 로그인 거절, 재인증, 2인 승인이 토큰 신원으로
 *   - 발급자가 죽어도 이미 받은 키로 계속 검증
 */
process.env.AUTH_MODE = 'oidc';
process.env.UNIVERSITY_ID ??= 'UNIV-A';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';
process.env.THROTTLE_MODE = 'off';

const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const AUD = 'wonseoro-admission-api';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
interface Realm {
  key: PrivateKey;
  jwk: JWK;
}

let available = false;
let server: Server;
let base = '';
let app: NestFastifyApplication;
let db: Db;
const realms: Record<'applicant' | 'staff', Realm> = {} as never;
const created = { policies: [] as string[], applicants: [] as string[] };

async function realm(kid: string): Promise<Realm> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return { key: privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
}

function issuer(name: 'applicant' | 'staff') {
  return `${base}/realms/${name}`;
}

async function token(
  name: 'applicant' | 'staff',
  sub: string,
  o: { roles?: string[]; acr?: string; authAgoSec?: number; expSec?: number; signWith?: PrivateKey; username?: string; aud?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const r = realms[name];
  return new SignJWT({
    ...(name === 'staff' ? { roles: o.roles ?? ['admission-admin'], acr: o.acr ?? 'mfa', preferred_username: o.username ?? sub } : { acr: '1' }),
    auth_time: now - (o.authAgoSec ?? 5),
  })
    .setProtectedHeader({ alg: 'RS256', kid: r.jwk.kid! })
    .setIssuer(issuer(name))
    .setAudience(o.aud ?? AUD)
    .setSubject(sub)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + (o.expSec ?? 300))
    .sign(o.signWith ?? r.key);
}

async function call(method: string, url: string, bearer?: string, o: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json', 'idempotency-key': `oidc-${randomUUID()}` } : {}),
      ...(o.headers ?? {}),
    },
    ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
  });
  let json: Record<string, unknown> = {};
  try {
    json = res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.statusCode, json, headers: res.headers };
}

before(async () => {
  if (!process.env.DATABASE_URL) return;
  realms.applicant = await realm('applicant-k1');
  realms.staff = await realm('staff-k1');
  server = createServer((req, res) => {
    const m = /^\/realms\/(applicant|staff)\/(.*)$/.exec(req.url ?? '');
    if (!m) return res.writeHead(404).end();
    const name = m[1] as 'applicant' | 'staff';
    res.setHeader('content-type', 'application/json');
    if (m[2] === '.well-known/openid-configuration') {
      return res.end(JSON.stringify({ issuer: issuer(name), jwks_uri: `${issuer(name)}/certs` }));
    }
    if (m[2] === 'certs') return res.end(JSON.stringify({ keys: [realms[name].jwk] }));
    return res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OIDC_APPLICANT_ISSUER = issuer('applicant');
  process.env.OIDC_STAFF_ISSUER = issuer('staff');

  const { NestFactory } = await import('@nestjs/core');
  const { FastifyAdapter } = await import('@nestjs/platform-fastify');
  const { AppModule } = await import('../../app.module');
  const { configureHttpApp } = await import('../../app.setup');
  const kit = await import('@wonseoro/server-kit');
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false, bodyParser: false });
  configureHttpApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(kit.Db);
  available = await db.healthy();
});

after(async () => {
  if (db && available) {
    for (const id of created.policies) await db.query(`DELETE FROM deadline_policy WHERE id = $1`, [id]).catch(() => {});
  }
  await app?.close();
  server?.close();
});

const SKIP = 'DATABASE_URL 이 없거나 DB 에 닿지 않는다';
/** 지원자 토큰이 필요한 경로 — 없는 원서라 토큰이 맞으면 404(소유권), 토큰이 틀리면 401 */
const PROTECTED = `/api/v1/applications/00000000-0000-4000-8000-000000000000`;

describe('OIDC 인증 — HTTP (T-M5-02·10 단계 3)', () => {
  it('계약의 공개 경로는 토큰 없이, 지원자 경로는 토큰이 있어야 한다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    // 모집을 지정한다 — 지정하지 않으면 가장 최근에 연 OPEN 모집을 고르는데, 동시에 도는 시험(config-governance·
    // deadline-extension)이 마감 정책 없는 OPEN 모집을 잠시 만들어 두면 그 모집이 뽑혀 503 이 된다
    assert.equal((await call('GET', `/api/v1/meta/time?admissionCycleId=${CYCLE}`)).status, 200);
    // 모집·전형·모집단위는 공개다(계약 1.7.0, D-65) — 로그인 전 화면과 운영 콘솔이 보인다
    assert.equal((await call('GET', '/api/v1/admission-cycles/current')).status, 200);
    const anon = await call('GET', PROTECTED);
    assert.equal(anon.status, 401);
    assert.equal(anon.json.code, 'UNAUTHENTICATED');
    assert.match(String(anon.headers['www-authenticate']), /^Bearer/);
    assert.equal((await call('GET', PROTECTED, 'not.a.token')).status, 401);
  });

  it('처음 온 지원자는 등록된다 — 개인정보 없이, 한 번만', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const sub = `oidc-${randomUUID()}`;
    const t = await token('applicant', sub);
    assert.equal((await call('GET', PROTECTED, t)).status, 404);
    assert.equal((await call('GET', PROTECTED, t)).status, 404);
    const { rows } = await db.query<{ n: string; key: string; len: number }>(
      `SELECT count(*) AS n, max(pii_key_version) AS key, max(octet_length(pii_ciphertext)) AS len FROM applicant WHERE subject_token = $1`,
      [sub],
    );
    assert.deepEqual([Number(rows[0]!.n), rows[0]!.key, Number(rows[0]!.len)], [1, 'none', 0]);
  });

  it('남의 원서는 못 본다 — 토큰의 주인만, 헤더를 꾸며도(BOLA)', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const a = await token('applicant', `oidc-a-${randomUUID()}`);
    const b = await token('applicant', `oidc-b-${randomUUID()}`);
    const made = await call('POST', '/api/v1/applications', a, { body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const id = made.json.id as string;
    const { rows } = await db.query<{ applicant_id: string }>(`SELECT applicant_id FROM application WHERE id = $1`, [id]);
    const ownerId = rows[0]!.applicant_id;

    assert.equal((await call('GET', `/api/v1/applications/${id}`, a)).status, 200);
    assert.equal((await call('GET', `/api/v1/applications/${id}`, b)).status, 404);
    // 개발 모드의 신원 헤더를 꾸며도 oidc 에서는 읽지 않는다
    const spoof = await call('GET', `/api/v1/applications/${id}`, b, { headers: { 'x-applicant-id': ownerId, 'x-authenticated-applicant': ownerId } });
    assert.equal(spoof.status, 404);
  });

  it('렐름이 섞이지 않는다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const staff = await token('staff', 'admin-a');
    const applicant = await token('applicant', `oidc-${randomUUID()}`);
    assert.equal((await call('GET', PROTECTED, staff)).status, 401);
    assert.equal((await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, applicant)).status, 401);
  });

  it('위조·만료·다른 대상 토큰을 거절한다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const other = await realm('applicant-k1'); // 같은 kid, 다른 키
    assert.equal((await call('GET', PROTECTED, await token('applicant', 'x', { signWith: other.key }))).status, 401);
    assert.equal((await call('GET', PROTECTED, await token('applicant', 'x', { expSec: -120 }))).status, 401);
    assert.equal((await call('GET', PROTECTED, await token('applicant', 'x', { aud: 'wonseoro-central-api' }))).status, 401);
  });

  it('운영 API — 역할별로 열리는 곳만 열린다(수직 권한)', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const appId = randomUUID();
    const probes: Array<[string, string]> = [
      ['config', `/admin/v1/config/active?cycleId=${CYCLE}`],
      ['retention', `/admin/v1/retention/matrix`],
      ['recon', `/admin/v1/reconciliation/exceptions`],
      ['evidence', `/admin/v1/evidence/applications/${appId}?reason=${encodeURIComponent('감사 확인')}`],
    ];
    const table: Record<string, string> = {};
    for (const role of ['platform-viewer', 'sre-operator', 'admission-admin', 'security-auditor', 'release-controller', 'break-glass']) {
      const t = await token('staff', `staff-${role}`, { roles: [role] });
      const row: string[] = [];
      for (const [name, url] of probes) {
        const s = (await call('GET', url, t)).status;
        row.push(`${name}:${s === 401 || s === 403 ? s : 'open'}`);
      }
      table[role] = row.join(' ');
    }
    assert.deepEqual(table, {
      'platform-viewer': 'config:403 retention:403 recon:403 evidence:403',
      'sre-operator': 'config:403 retention:403 recon:403 evidence:403',
      'admission-admin': 'config:open retention:open recon:open evidence:403',
      'security-auditor': 'config:403 retention:403 recon:403 evidence:open',
      'release-controller': 'config:403 retention:403 recon:403 evidence:403',
      'break-glass': 'config:403 retention:403 recon:403 evidence:403',
    });
  });

  it('비밀번호만으로 로그인한 담당자 토큰은 운영 API 를 열지 않는다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const res = await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, await token('staff', 'admin-a', { acr: 'pwd' }));
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'STEP_UP_REQUIRED');
    assert.match(String(res.headers['www-authenticate']), /acr_values="mfa"/);
  });

  it('2인 승인은 토큰의 담당자로 — 작성자 본인 승인 불가, 꾸민 헤더는 무시, 오래된 인증은 재인증', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const adminA = await token('staff', 'sub-a', { username: 'admin-a' });
    const adminB = await token('staff', 'sub-b', { username: 'admin-b' });
    const draft = await call('POST', '/admin/v1/deadline-policies', adminA, {
      body: { cycleId: CYCLE, version: `oidc-${randomUUID().slice(0, 8)}`, mode: 'FINALIZED_COMMIT_BEFORE_DEADLINE', deadlineAt: '2099-12-31T09:00:00Z' },
      headers: { 'x-admin-id': 'someone-else' },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    const policyId = (draft.json.id ?? draft.json.policyId) as string;
    created.policies.push(policyId);
    const own = await db.query<{ created_by: string }>(`SELECT created_by FROM deadline_policy WHERE id = $1`, [policyId]);
    assert.equal(own.rows[0]!.created_by, 'admin-a', '작성자는 토큰의 담당자다 — 헤더가 아니다');

    // 작성자 본인은 승인할 수 없다
    // (업무 규칙이 막는다 — 역할 검사는 통과한 뒤다. 승인 기록이 남지 않았는지로 본다)
    const self = await call('POST', `/admin/v1/deadline-policies/${policyId}/approve`, adminA, { body: {} });
    assert.ok(self.status >= 400 && self.status !== 401, `작성자 승인: ${self.status}`);
    const none = await db.query<{ approved_by_1: string | null }>(`SELECT approved_by_1 FROM deadline_policy WHERE id = $1`, [policyId]);
    assert.equal(none.rows[0]!.approved_by_1, null);

    // 10분 전 인증으로는 승인 못 한다 — 재인증
    const stale = await call('POST', `/admin/v1/deadline-policies/${policyId}/approve`, await token('staff', 'sub-b', { username: 'admin-b', authAgoSec: 600 }), { body: {} });
    assert.equal(stale.status, 401);
    assert.equal(stale.json.code, 'STEP_UP_REQUIRED');
    assert.match(String(stale.headers['www-authenticate']), /max_age=300/);

    // 방금 인증한 다른 담당자 — 승인된다. 꾸민 헤더(작성자 이름)는 무시된다
    const ok = await call('POST', `/admin/v1/deadline-policies/${policyId}/approve`, adminB, { body: {}, headers: { 'x-admin-id': 'admin-a' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const approved = await db.query<{ approved_by_1: string }>(`SELECT approved_by_1 FROM deadline_policy WHERE id = $1`, [policyId]);
    assert.equal(approved.rows[0]!.approved_by_1, 'admin-b');
  });

  it('발급자가 죽어도 이미 받은 키로 계속 검증한다(T-M3-06)', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const t = await token('applicant', `oidc-${randomUUID()}`);
    assert.equal((await call('GET', PROTECTED, t)).status, 404);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal((await call('GET', PROTECTED, t)).status, 404, '발급자가 멈춰도 토큰은 통과(404 = 인증 뒤 소유권 판단)');
    const staff = await token('staff', 'admin-a');
    assert.equal((await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, staff)).status, 200);
  });
});
