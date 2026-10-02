import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

/**
 * 관리자 로그인 — 콘솔 서버가 하는 OIDC (T-M5-10 단계 5, docs/12-authentication-plan.md A7)
 *
 * **브라우저에는 토큰을 주지 않는다.** 콘솔 서버가 Authorization Code + PKCE 로 담당자 렐름에서 토큰을 받고,
 * 그 토큰을 암호화(AES-256-GCM)한 쿠키 하나만 브라우저에 둔다 — `HttpOnly`(스크립트가 못 읽는다)·`SameSite=Lax`
 * (다른 사이트의 요청에는 실리지 않는다, 로그인 콜백 같은 맨 위 이동에만)·운영에서는 `Secure`. 서버가 여러 대여도
 * 세션 저장소가 필요 없다. 운영 API 를 부를 때는 이 서버가 쿠키를 풀어 `Authorization: Bearer` 를 붙인다.
 *
 * 설정(서버 환경변수 — 브라우저로 가지 않는다)
 *   ADMIN_AUTH_MODE=oidc        이 모드를 켠다. 아니면 개발용 담당자 지정(개발 서버)·운영 거절
 *   ADMIN_OIDC_ISSUER           담당자 렐름 (예: http://localhost:18080/realms/wonseoro-staff)
 *   ADMIN_OIDC_CLIENT_ID/SECRET 콘솔 클라이언트(기밀)
 *   ADMIN_PUBLIC_URL            이 콘솔의 주소 — 로그인 콜백 주소를 만든다
 *   ADMIN_SESSION_SECRET        세션 쿠키 암호화 비밀(32자 이상)
 */

export const OIDC_MODE = process.env.ADMIN_AUTH_MODE === 'oidc';
export const SESSION_COOKIE = 'wonseoro_admin_session';
export const TX_COOKIE = 'wonseoro_admin_login';

const cfg = {
  issuer: (process.env.ADMIN_OIDC_ISSUER ?? '').replace(/\/$/, ''),
  clientId: process.env.ADMIN_OIDC_CLIENT_ID ?? 'admin-web',
  clientSecret: process.env.ADMIN_OIDC_CLIENT_SECRET ?? '',
  publicUrl: (process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:4100').replace(/\/$/, ''),
  secret: process.env.ADMIN_SESSION_SECRET ?? '',
  acr: process.env.ADMIN_OIDC_ACR ?? 'mfa',
};

export const REDIRECT_PATH = '/auth/callback';
const redirectUri = () => `${cfg.publicUrl}${REDIRECT_PATH}`;

/** 설정이 모자라면 이유. 운영에서는 http·로컬 발급자도 거절한다(개발용 발급자가 운영에 섞이지 않게) */
export function oidcConfigProblem(): string | null {
  if (!cfg.issuer) return '관리자 로그인 발급자 주소가 설정되지 않았습니다.';
  if (!cfg.clientSecret) return '관리자 로그인 클라이언트 비밀이 설정되지 않았습니다.';
  if (cfg.secret.length < 32) return '관리자 세션 비밀이 설정되지 않았거나 너무 짧습니다.';
  if (process.env.NODE_ENV === 'production') {
    const u = new URL(cfg.issuer);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost');
    if (u.protocol !== 'https:' || local) return '관리자 로그인 발급자 주소가 운영에 쓸 수 없는 주소입니다.';
    if (!cfg.publicUrl.startsWith('https://')) return '콘솔 주소가 https 가 아닙니다.';
  }
  return null;
}

export const secureCookies = () => cfg.publicUrl.startsWith('https://');

/* ── 쿠키 봉인 ─────────────────────────────────────────────────────── */

const key = () => createHash('sha256').update(`wonseoro-admin-session:${cfg.secret}`).digest();

/** 값을 암호화해 쿠키에 넣을 문자열로. 위조·변조된 쿠키는 풀리지 않는다(GCM 인증 태그) */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}

/* ── 발급자 ─────────────────────────────────────────────────────────── */

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

let discovery: Promise<Discovery> | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function meta(): Promise<Discovery> {
  discovery ??= fetch(`${cfg.issuer}/.well-known/openid-configuration`, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) throw new Error(`discovery ${r.status}`);
      const d = (await r.json()) as Discovery;
      if (d.issuer !== cfg.issuer) throw new Error('discovery 의 issuer 가 설정과 다르다');
      return d;
    })
    .catch((err: unknown) => {
      discovery = null; // 다음 요청에서 다시 시도
      throw err;
    });
  return discovery;
}

/* ── 세션 ──────────────────────────────────────────────────────────── */

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  /** 액세스 토큰 만료(ms) */
  expiresAt: number;
  user: { username: string; name: string | null; roles: string[] };
  /** 사람이 직접 인증한 시각(초) — 민감 동작 전 재인증 판단에 화면이 쓴다 */
  authTime: number | null;
}

interface LoginTx {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  at: number;
}

/** 같은 콘솔 안의 경로만 돌아간다 — 로그인을 다른 사이트로 가는 문으로 쓰지 못하게 */
export function safeReturnTo(raw: string | null | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}

/**
 * 로그인 시작 — 발급자 로그인 화면 주소와, 콜백에서 대조할 값(봉인 쿠키).
 * @param stepUp 민감 동작 전 다시 인증 — 비밀번호·OTP 를 다시 묻는다(`max_age=0`)
 */
export async function beginLogin(returnTo: string, stepUp: boolean): Promise<{ url: string; tx: string }> {
  const m = await meta();
  const tx: LoginTx = {
    state: randomBytes(16).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    returnTo: safeReturnTo(returnTo),
    at: Date.now(),
  };
  const url = new URL(m.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid profile',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: createHash('sha256').update(tx.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    acr_values: cfg.acr,
    ui_locales: 'ko',
    ...(stepUp ? { max_age: '0' } : {}),
  }).toString();
  return { url: url.toString(), tx: seal(tx) };
}

function sessionFrom(tokens: { access_token: string; refresh_token?: string; expires_in?: number }): AdminSession {
  // 액세스 토큰은 방금 발급자에게서 직접(서버 대 서버) 받았다. 서명 검증은 운영 API 가 한다 — 여기서는 화면에 보일 값만 읽는다
  const c = decodeJwt(tokens.access_token) as Record<string, unknown>;
  const roles = Array.isArray(c.roles) ? (c.roles as unknown[]).filter((r): r is string => typeof r === 'string') : [];
  // 화면에 보일 이름 — 발급자가 만든 표시 이름(name). 없으면 사용자 이름만 보인다
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + (tokens.expires_in ?? 300) * 1000,
    user: { username: typeof c.preferred_username === 'string' ? c.preferred_username : String(c.sub), name, roles },
    authTime: typeof c.auth_time === 'number' ? c.auth_time : null,
  };
}

/** 콜백 — state·PKCE·ID 토큰(nonce·서명·발급자·대상)을 확인하고 세션을 만든다 */
export async function completeLogin(params: URLSearchParams, txCookie: string | undefined): Promise<{ session: AdminSession; returnTo: string }> {
  const tx = unseal<LoginTx>(txCookie);
  if (!tx || Date.now() - tx.at > 10 * 60_000) throw new LoginError('로그인 시간이 지났습니다. 다시 로그인해 주십시오.');
  if (params.get('error')) throw new LoginError('로그인이 완료되지 않았습니다. 다시 로그인해 주십시오.');
  if (!params.get('code') || params.get('state') !== tx.state) throw new LoginError('로그인 요청을 확인할 수 없습니다. 다시 로그인해 주십시오.');

  const m = await meta();
  const res = await fetch(m.token_endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code')!,
      redirect_uri: redirectUri(),
      code_verifier: tx.verifier,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) throw new LoginError('로그인을 마치지 못했습니다. 다시 로그인해 주십시오.');
  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number };
  if (!tokens.id_token) throw new LoginError('로그인을 마치지 못했습니다. 다시 로그인해 주십시오.');

  jwks ??= createRemoteJWKSet(new URL(m.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: cfg.issuer, audience: cfg.clientId }).catch(() => {
    throw new LoginError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주십시오.');
  });
  if (payload.nonce !== tx.nonce) throw new LoginError('로그인 요청을 확인할 수 없습니다. 다시 로그인해 주십시오.');
  return { session: sessionFrom(tokens), returnTo: tx.returnTo };
}

/** 액세스 토큰이 곧 끝나면 갱신 토큰으로 바꾼다. 갱신이 안 되면(세션 만료·발급자 로그아웃) null — 다시 로그인 */
export async function freshSession(session: AdminSession): Promise<{ session: AdminSession; changed: boolean } | null> {
  if (session.expiresAt - Date.now() > 30_000) return { session, changed: false };
  if (!session.refreshToken) return null;
  const m = await meta();
  const res = await fetch(m.token_endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const next = sessionFrom((await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number });
  // 갱신으로는 사람이 다시 인증한 것이 아니다 — 인증 시각은 처음 로그인(또는 재인증) 때의 것을 지킨다
  return { session: { ...next, authTime: next.authTime ?? session.authTime }, changed: true };
}

/** 발급자 로그아웃 주소(있으면). 콘솔 쿠키는 부르는 쪽이 지운다 */
export async function endSessionUrl(): Promise<string | null> {
  const m = await meta().catch(() => null);
  if (!m?.end_session_endpoint) return null;
  const url = new URL(m.end_session_endpoint);
  url.search = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: `${cfg.publicUrl}/` }).toString();
  return url.toString();
}

export class LoginError extends Error {}

/** 세션 쿠키 옵션 — 쿠키 수명은 발급자 세션보다 길 필요가 없다(발급자 SSO 최대 10시간) */
export function sessionCookieOptions(maxAgeSec = 10 * 3600) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: secureCookies(), path: '/', maxAge: maxAgeSec };
}
