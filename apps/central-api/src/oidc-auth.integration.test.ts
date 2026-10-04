import 'reflect-metadata';
import { COMMON_PROFILE_COLLECTION_CONSENT } from '@wonseoro/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { parse } from 'yaml';

/**
 * 중앙 API OIDC 인증 — T-M5-02 단계 4
 *
 * ① (DB 없이) 실제 AppModule 컨트롤러의 경로를 계약과 대조한다 — 지원자 경로(전역 oidc)는 토큰 필요, 내부 경로는 아님
 * ② (실 PostgreSQL) 시험이 띄운 발급자로 서명한 토큰을 실제 HTTP 조립(app.setup.ts)에 보낸다 —
 *    토큰 없음·다른 렐름·대학 전용 대상 거절, 공통원서·"내 원서" 는 토큰의 주체로만(꾸민 헤더 무시), 발급자 정지 중 검증 지속
 */
process.env.AUTH_MODE = 'oidc';
process.env.OIDC_APPLICANT_ISSUER = 'http://127.0.0.1:1/realms/applicant'; // before() 에서 실제 포트로 바꾼다

const AUD = 'wonseoro-central-api';
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let server: Server;
let base = '';
let app: NestFastifyApplication | null = null;
let available = false;
const keys: Record<'applicant' | 'staff', { key: PrivateKey; jwk: JWK }> = {} as never;
const SKIP = 'DATABASE_URL 이 없거나 DB 에 닿지 않는다';

const issuer = (name: 'applicant' | 'staff') => `${base}/realms/${name}`;

async function token(sub: string, o: { realm?: 'applicant' | 'staff'; aud?: string; signWith?: PrivateKey } = {}) {
  const realm = o.realm ?? 'applicant';
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now })
    .setProtectedHeader({ alg: 'RS256', kid: keys[realm].jwk.kid! })
    .setIssuer(issuer(realm))
    .setAudience(o.aud ?? AUD)
    .setSubject(sub)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + 300)
    .sign(o.signWith ?? keys[realm].key);
}

async function call(method: string, url: string, bearer?: string, o: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app!.inject({
    method: method as 'GET',
    url,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
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
  return { status: res.statusCode, json };
}

before(async () => {
  for (const name of ['applicant', 'staff'] as const) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    keys[name] = { key: privateKey, jwk: { ...(await exportJWK(publicKey)), kid: `${name}-k1`, alg: 'RS256', use: 'sig' } };
  }
  server = createServer((req, res) => {
    const m = /^\/realms\/(applicant|staff)\/(.*)$/.exec(req.url ?? '');
    if (!m) return res.writeHead(404).end();
    const name = m[1] as 'applicant' | 'staff';
    res.setHeader('content-type', 'application/json');
    if (m[2] === '.well-known/openid-configuration') return res.end(JSON.stringify({ issuer: issuer(name), jwks_uri: `${issuer(name)}/certs` }));
    if (m[2] === 'certs') return res.end(JSON.stringify({ keys: [keys[name].jwk] }));
    return res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OIDC_APPLICANT_ISSUER = issuer('applicant');

  if (!process.env.DATABASE_URL) return;
  const { NestFactory } = await import('@nestjs/core');
  const { FastifyAdapter } = await import('@nestjs/platform-fastify');
  const { AppModule } = await import('./app.module');
  const { configureHttpApp } = await import('./app.setup');
  const { Db } = await import('@wonseoro/server-kit');
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false, bodyParser: false });
  configureHttpApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  available = await app.get(Db).healthy();
});

after(async () => {
  await app?.close();
  server?.close();
});

describe('중앙 경로 분류 — 계약과 같다', () => {
  it('지원자 경로는 토큰이 필요하고 내부·건강 경로는 아니다', async () => {
    const { AppModule } = await import('./app.module');
    const { needsApplicantToken } = await import('./oidc-auth');
    const spec = parse(readFileSync(resolve(__dirname, '../../../packages/contracts/openapi/k-admission.v1.yaml'), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown[] }>>;
    };
    const names: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT' };
    const walk = (m: unknown, seen = new Set<unknown>()): Function[] => {
      if (!m || seen.has(m)) return [];
      seen.add(m);
      const own = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m as object) ?? []) as Function[];
      const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, m as object) ?? []) as unknown[];
      return [...own, ...imports.flatMap((x) => walk((x as { module?: unknown })?.module ?? x, seen))];
    };
    const join = (...p: string[]) => `/${p.map((x) => x.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;
    let checked = 0;
    const wrong: string[] = [];
    for (const ctrl of walk(AppModule)) {
      const prefix = (Reflect.getMetadata(PATH_METADATA, ctrl) ?? '') as string;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = (ctrl.prototype as Record<string, unknown>)[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
        if (method === undefined) continue;
        const url = join(prefix, (Reflect.getMetadata(PATH_METADATA, fn) ?? '') as string);
        const verb = names[method] ?? String(method);
        const op = Object.entries(spec.paths).find(([p]) => p.replace(/\{([^}]+)\}/g, ':$1') === url)?.[1]?.[verb.toLowerCase()];
        if (!op?.operationId) continue;
        checked += 1;
        const contractNeeds = op.security === undefined; // 전역 oidc. []·mutualTLS 는 지원자 토큰이 아니다
        if (needsApplicantToken(verb, url) !== contractNeeds) wrong.push(`${verb} ${url}`);
      }
    }
    assert.ok(checked >= 5, `대조한 경로가 너무 적다: ${checked}`);
    assert.deepEqual(wrong, []);
  });
});

describe('중앙 OIDC 인증 — HTTP (T-M5-02 단계 4)', () => {
  it('토큰 없이·다른 렐름·대학 전용 대상·위조 토큰은 401', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const r = await call('GET', '/api/v1/profile');
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHENTICATED');
    assert.equal((await call('GET', '/api/v1/profile', await token('x', { realm: 'staff' }))).status, 401);
    assert.equal((await call('GET', '/api/v1/profile', await token('x', { aud: 'wonseoro-admission-api' }))).status, 401);
    const { privateKey } = await generateKeyPair('RS256');
    assert.equal((await call('GET', '/api/v1/profile', await token('x', { signWith: privateKey }))).status, 401);
    assert.equal((await call('GET', '/api/v1/dashboard/applications')).status, 401);
  });

  it('건강 확인은 토큰 없이 된다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    assert.equal((await call('GET', '/healthz')).status, 200);
  });

  it('공통원서는 토큰의 주체로만 읽고 쓴다 — 꾸민 헤더는 무시된다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const me = await token(`oidc-me-${randomUUID()}`);
    const other = `oidc-other-${randomUUID()}`;
    const saved = await call('PUT', '/api/v1/profile', me, { body: { fields: { contactEmail: 'me@example.kr' }, consents: [], collectionConsentVersion: COMMON_PROFILE_COLLECTION_CONSENT.version } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const mine = await call('GET', '/api/v1/profile', me);
    assert.equal((mine.json.fields as Record<string, unknown>)?.contactEmail, 'me@example.kr');

    const stranger = await call('GET', '/api/v1/profile', await token(other));
    assert.equal(stranger.status, 200);
    assert.notEqual((stranger.json.fields as Record<string, unknown> | undefined)?.contactEmail, 'me@example.kr');
    // 개발·게이트웨이 헤더로 남의 토큰을 주장해도 읽지 않는다
    const spoof = await call('GET', '/api/v1/profile', await token(other), { headers: { 'x-subject-token': 'whatever', 'x-authenticated-subject': 'whatever' } });
    assert.notEqual((spoof.json.fields as Record<string, unknown> | undefined)?.contactEmail, 'me@example.kr');
  });

  it('"내 원서" 는 토큰으로 열린다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const r = await call('GET', '/api/v1/dashboard/applications', await token(`oidc-${randomUUID()}`));
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.applications));
  });

  it('발급자가 죽어도 이미 받은 키로 계속 검증한다', async (ctx) => {
    if (!available) return ctx.skip(SKIP);
    const t = await token(`oidc-${randomUUID()}`);
    assert.equal((await call('GET', '/api/v1/profile', t)).status, 200);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal((await call('GET', '/api/v1/profile', t)).status, 200);
  });
});
