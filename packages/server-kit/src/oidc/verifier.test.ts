import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { OidcTokenError, OidcUnavailableError, OidcVerifier } from './verifier';

const ISSUER = 'https://id.test/realms/wonseoro-staff';
const AUDIENCE = 'wonseoro-admission-api';
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/** 손으로 돌리는 시계와, 켜고 끌 수 있는 가짜 발급자 */
async function harness(o: { snapshotFile?: string; maxStaleMs?: number } = {}) {
  let t = Date.UTC(2026, 9, 2, 12, 0, 0);
  const keyPairs = new Map<string, { privateKey: PrivateKey; jwk: JWK }>();
  const addKey = async (kid: string) => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    keyPairs.set(kid, { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } });
  };
  await addKey('k1');
  let published = ['k1'];
  let up = true;
  const calls = { discovery: 0, jwks: 0 };
  const fakeFetch = (async (url: string | URL) => {
    const u = String(url);
    if (!up) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (u.endsWith('/.well-known/openid-configuration')) {
      calls.discovery += 1;
      return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` });
    }
    calls.jwks += 1;
    return Response.json({ keys: published.map((k) => keyPairs.get(k)!.jwk) });
  }) as typeof fetch;

  const verifier = new OidcVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    fetch: fakeFetch,
    now: () => t,
    refreshIntervalMs: 10 * 60_000,
    unknownKidCooldownMs: 30_000,
    maxStaleMs: o.maxStaleMs ?? 24 * 60 * 60_000,
    snapshotFile: o.snapshotFile,
  });

  const sign = (claims: Record<string, unknown> = {}, opt: { kid?: string; iss?: string; aud?: string | string[]; expSec?: number; alg?: string } = {}) => {
    const kid = opt.kid ?? 'k1';
    const nowSec = Math.floor(t / 1000);
    return new SignJWT({ roles: ['admission-admin'], acr: 'mfa', auth_time: nowSec, ...claims })
      .setProtectedHeader({ alg: opt.alg ?? 'RS256', kid })
      .setIssuer(opt.iss ?? ISSUER)
      .setAudience(opt.aud ?? AUDIENCE)
      .setSubject('staff-admin-a')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + (opt.expSec ?? 300))
      .sign(keyPairs.get(kid)!.privateKey);
  };

  return {
    verifier,
    sign,
    calls,
    addKey,
    publish: (kids: string[]) => {
      published = kids;
    },
    setUp: (v: boolean) => {
      up = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
}

const rejects = (p: Promise<unknown>, problem: string) =>
  assert.rejects(p, (e: unknown) => e instanceof OidcTokenError && e.problem === problem);

describe('OidcVerifier — 누구인지', () => {
  it('맞는 토큰에서 주체·역할·인증 수준·인증 시각을 꺼낸다', async () => {
    const h = await harness();
    const v = await h.verifier.verify(await h.sign());
    assert.equal(v.subject, 'staff-admin-a');
    assert.deepEqual(v.roles, ['admission-admin']);
    assert.equal(v.acr, 'mfa');
    assert.equal(typeof v.authTime, 'number');
  });

  it('Keycloak 형식(realm_access.roles)의 역할도 읽는다', async () => {
    const h = await harness();
    const v = await h.verifier.verify(await h.sign({ roles: undefined, realm_access: { roles: ['security-auditor'] } }));
    assert.deepEqual(v.roles, ['security-auditor']);
  });

  it('다른 발급자·다른 대상·만료된 토큰을 거절한다', async () => {
    const h = await harness();
    await rejects(h.verifier.verify(await h.sign({}, { iss: 'https://evil.test/realms/x' })), 'invalid-claims');
    await rejects(h.verifier.verify(await h.sign({}, { aud: 'wonseoro-central-api' })), 'invalid-claims');
    const short = await h.sign({}, { expSec: 60 });
    h.advance(91_000); // 만료 60초 + 허용 오차 30초를 넘긴다
    await rejects(h.verifier.verify(short), 'expired');
  });

  it('시계 오차 30초 안은 받는다', async () => {
    const h = await harness();
    const token = await h.sign({}, { expSec: 60 });
    h.advance(85_000);
    await h.verifier.verify(token);
  });

  it('서명을 바꾼 토큰을 거절한다', async () => {
    const h = await harness();
    const [head, body] = (await h.sign()).split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), roles: ['break-glass'] })).toString('base64url');
    const other = (await h.sign()).split('.')[2] as string;
    await rejects(h.verifier.verify(`${head}.${forged}.${other}`), 'invalid-signature');
  });

  it('alg none·HS256(공개키를 비밀로 쓰는 위조)를 거절한다', async () => {
    const h = await harness();
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = enc({ sub: 'x', iss: ISSUER, aud: AUDIENCE, iat: 1, exp: 9e9 });
    await rejects(h.verifier.verify(`${enc({ alg: 'none', kid: 'k1' })}.${body}.`), 'unsupported-algorithm');
    await rejects(h.verifier.verify(`${enc({ alg: 'HS256', kid: 'k1' })}.${body}.c2ln`), 'unsupported-algorithm');
  });

  it('kid 가 없으면 거절한다', async () => {
    const h = await harness();
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await rejects(h.verifier.verify(`${enc({ alg: 'RS256' })}.${enc({ sub: 'x' })}.c2ln`), 'unknown-key');
  });

  it('Bearer 형식이 아니면 거절한다', () => {
    assert.throws(() => OidcVerifier.bearer(undefined), (e: unknown) => e instanceof OidcTokenError && e.problem === 'missing');
    assert.throws(() => OidcVerifier.bearer('Basic abc'), (e: unknown) => e instanceof OidcTokenError && e.problem === 'malformed');
    assert.equal(OidcVerifier.bearer('Bearer a.b.c'), 'a.b.c');
  });
});

describe('JWKS 캐시 — 발급자가 끊겨도 (T-M3-06)', () => {
  it('키를 한 번 받으면 발급자가 죽어도 이미 받은 키로 계속 검증한다', async () => {
    const h = await harness();
    await h.verifier.verify(await h.sign());
    h.setUp(false);
    h.advance(2 * 60 * 60_000); // 2시간 단절
    const v = await h.verifier.verify(await h.sign());
    assert.equal(v.subject, 'staff-admin-a');
    assert.equal(h.verifier.status().source, 'issuer');
    assert.ok(h.verifier.status().lastError, '다시 받기 실패는 기록한다');
  });

  it('최대 보관 시간을 넘긴 키는 쓰지 않는다 — 닫힌 실패(503)', async () => {
    const h = await harness({ maxStaleMs: 6 * 60 * 60_000 });
    await h.verifier.verify(await h.sign());
    h.setUp(false);
    h.advance(6 * 60 * 60_000 + 1);
    await assert.rejects(h.verifier.verify(await h.sign()), OidcUnavailableError);
    h.setUp(true);
    h.advance(30_000);
    await h.verifier.verify(await h.sign()); // 발급자가 돌아오면 다시 받는다
  });

  it('키를 한 번도 못 받았으면 503 이다 — 토큰 탓이 아니다', async () => {
    const h = await harness();
    h.setUp(false);
    await assert.rejects(h.verifier.verify(await h.sign()), OidcUnavailableError);
  });

  it('키 교체: 모르는 kid 가 오면 한 번 다시 받아 새 키로 검증한다', async () => {
    const h = await harness();
    await h.verifier.verify(await h.sign());
    await h.addKey('k2');
    h.publish(['k1', 'k2']);
    const before = h.calls.jwks;
    await h.verifier.verify(await h.sign({}, { kid: 'k2' }));
    assert.equal(h.calls.jwks, before + 1);
  });

  it('모르는 kid 를 동시에 쏟아부어도 발급자는 쿨다운에 한 번만 두드린다', async () => {
    const h = await harness();
    await h.verifier.verify(await h.sign());
    await h.addKey('ghost');
    const forged = await h.sign({}, { kid: 'ghost' }); // 발급자는 ghost 를 공개하지 않는다
    const before = h.calls.jwks;
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => h.verifier.verify(forged)));
    assert.ok(results.every((r) => r.status === 'rejected' && (r.reason as OidcTokenError).problem === 'unknown-key'));
    assert.equal(h.calls.jwks, before + 1);
    await rejects(h.verifier.verify(forged), 'unknown-key');
    assert.equal(h.calls.jwks, before + 1, '쿨다운 안에서는 다시 받지 않는다');
  });

  it('키가 오래되면 뒤에서 다시 받는다 — 요청은 기다리지 않는다', async () => {
    const h = await harness();
    await h.verifier.verify(await h.sign());
    const before = h.calls.jwks;
    h.advance(11 * 60_000);
    await h.verifier.verify(await h.sign());
    await new Promise((r) => setImmediate(r));
    assert.equal(h.calls.jwks, before + 1);
  });

  it('발급자 장애 중에 다시 떠도 스냅숏의 키로 검증한다', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.jwks-test-'));
    try {
      const snapshotFile = join(dir, 'jwks.json');
      const first = await harness({ snapshotFile });
      const token = await first.sign();
      await first.verifier.verify(token);

      // 같은 키를 쓰는 발급자에 대해, 새 프로세스(새 검증기)가 발급자 장애 중에 뜬다
      const restarted = new OidcVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        fetch: (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch,
        snapshotFile,
        now: first.now,
      });
      const v = await restarted.verify(token);
      assert.equal(v.subject, 'staff-admin-a');
      assert.equal(restarted.status().source, 'snapshot');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('다른 발급자를 가리키는 discovery 는 쓰지 않는다', async () => {
    const v = new OidcVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      fetch: (async () => Response.json({ issuer: 'https://evil.test', jwks_uri: 'https://evil.test/certs' })) as typeof fetch,
    });
    await assert.rejects(v.verify('eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.e30.c2ln'), OidcUnavailableError);
    assert.match(v.status().lastError ?? '', /issuer/);
  });

  it('비밀 키 성분이 섞인 JWK 는 들고 있지 않는다', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const leaked = { ...(await exportJWK(privateKey)), kid: 'leak', alg: 'RS256' };
    const v = new OidcVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: `${ISSUER}/certs`,
      fetch: (async () => Response.json({ keys: [leaked] })) as typeof fetch,
    });
    await assert.rejects(v.verify('eyJhbGciOiJSUzI1NiIsImtpZCI6ImxlYWsifQ.e30.c2ln'), OidcUnavailableError);
    assert.equal(v.status().keyCount, 0);
  });
});
