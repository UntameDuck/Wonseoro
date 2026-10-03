'use client';

/**
 * 지원자 본인확인(로그인) — 브라우저 OIDC, 공개 클라이언트 + PKCE (T-M5-02 단계 6, docs/12-authentication-plan.md A8)
 *
 * 지원자 렐름 발급자에서 Authorization Code + PKCE 로 토큰을 받는다. 클라이언트 비밀이 없는 공개 클라이언트라
 * 코드를 가로채도 PKCE 검증값 없이는 토큰으로 바꿀 수 없다.
 *
 * 토큰은 **이 탭의 sessionStorage** 에만 둔다 — 탭을 닫으면 사라지고 다른 사이트는 읽을 수 없다. 화면은 대학·중앙 API 를
 * 브라우저에서 직접 부르므로(CORS) 콘솔처럼 서버 쿠키에 숨길 수 없다. 대신 액세스 토큰 수명이 5분이고, 갱신 토큰은
 * 쓸 때마다 바뀌어(회전) 한 번 쓴 것은 다시 못 쓴다. 스크립트 주입(XSS)은 CSP·화면 문구 검사·입력 이스케이프가 막는다.
 *
 * 설정(빌드 때 박힌다): NEXT_PUBLIC_AUTH_MODE=oidc · NEXT_PUBLIC_OIDC_ISSUER · NEXT_PUBLIC_OIDC_CLIENT_ID
 */

export const OIDC_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === 'oidc';
const ISSUER = (process.env.NEXT_PUBLIC_OIDC_ISSUER ?? '').replace(/\/$/, '');
const CLIENT_ID = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID ?? 'applicant-web';

const TOKENS_KEY = 'wonseoro.auth.tokens';
const TX_KEY = 'wonseoro.auth.tx';
/** 세션이 시간으로 끝났다 — 다음 로그인은 발급자 세션이 남아 있어도 비밀번호를 다시 묻는다(공용 PC) */
const FORCE_LOGIN_KEY = 'wonseoro.auth.force-login';
export const CALLBACK_PATH = '/auth/callback';

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** 액세스 토큰 만료(ms) */
  expiresAt: number;
  /** 사람이 직접 인증한 시각(초) */
  authTime: number | null;
}

interface Tx {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

let discovery: Promise<Discovery> | null = null;
function meta(): Promise<Discovery> {
  discovery ??= fetch(`${ISSUER}/.well-known/openid-configuration`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`discovery ${r.status}`);
      const d = (await r.json()) as Discovery;
      if (d.issuer !== ISSUER) throw new Error('발급자 정보가 설정과 다르다');
      return d;
    })
    .catch((err: unknown) => {
      discovery = null;
      throw err;
    });
  return discovery;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
function claimsOf(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const json = decodeURIComponent(
    atob(part.replace(/-/g, '+').replace(/_/g, '/'))
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장소를 쓸 수 없으면 로그인이 이 탭에 남지 않는다 */
  }
}

/** 같은 화면 안의 경로만 — 로그인을 다른 사이트로 가는 문으로 쓰지 못하게 */
export function safeReturnTo(raw: string | null | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}

/**
 * 본인확인 시작 — 발급자 화면으로 간다.
 * @param stepUp 본인확인 다시 하기 — 발급자에 로그인이 남아 있어도 다시 묻는다(`max_age=0`). 요청 한도 해제(ADR-0009)
 */
export async function login(returnTo: string, stepUp = false): Promise<void> {
  const m = await meta();
  const tx: Tx = { state: random(16), nonce: random(16), verifier: random(32), returnTo: safeReturnTo(returnTo) };
  write(TX_KEY, tx);
  const force = stepUp || read<boolean>(FORCE_LOGIN_KEY) === true;
  const url = new URL(m.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: 'openid',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: await challengeOf(tx.verifier),
    code_challenge_method: 'S256',
    ui_locales: 'ko',
    ...(force ? { max_age: '0' } : {}),
  }).toString();
  window.location.assign(url.toString());
}

function store(t: { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }, keepAuthTime?: number | null): Tokens {
  const c = claimsOf(t.access_token);
  const tokens: Tokens = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    idToken: t.id_token ?? read<Tokens>(TOKENS_KEY)?.idToken ?? null,
    expiresAt: Date.now() + (t.expires_in ?? 300) * 1000,
    authTime: typeof c.auth_time === 'number' ? c.auth_time : (keepAuthTime ?? null),
  };
  write(TOKENS_KEY, tokens);
  return tokens;
}

export class LoginError extends Error {}

/** 콜백 — state·PKCE·nonce 를 확인하고 토큰을 받는다. 돌아갈 화면을 돌려준다 */
export async function completeLogin(params: URLSearchParams): Promise<string> {
  const tx = read<Tx>(TX_KEY);
  write(TX_KEY, null);
  if (!tx || params.get('error') || !params.get('code') || params.get('state') !== tx.state) {
    throw new LoginError('본인확인 요청을 확인할 수 없습니다.');
  }
  const m = await meta();
  const res = await fetch(m.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code')!,
      redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
      code_verifier: tx.verifier,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new LoginError('본인확인을 마치지 못했습니다.');
  const t = (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number };
  // ID 토큰은 발급자에게서 직접(TLS) 받았다 — 이 요청의 것인지 nonce 로만 확인한다. 서명 검증은 API 가 액세스 토큰으로 한다
  if (!t.id_token || claimsOf(t.id_token).nonce !== tx.nonce) throw new LoginError('본인확인 요청을 확인할 수 없습니다.');
  store(t);
  write(FORCE_LOGIN_KEY, null);
  return tx.returnTo;
}

let refreshing: Promise<Tokens | null> | null = null;
/** 발급자에 닿지 않았던 때 — 30초 동안은 요청마다 다시 두드리지 않는다 */
let unreachableUntil = 0;

/** 갱신 토큰으로 새 토큰을 받는다 — 발급자의 무활동 시간도 뒤로 민다. 안 되면 null(로그인이 끝났다) */
export function refresh(): Promise<Tokens | null> {
  refreshing ??= (async () => {
    const cur = read<Tokens>(TOKENS_KEY);
    if (!cur?.refreshToken) return null;
    if (Date.now() < unreachableUntil) return cur;
    try {
      const m = await meta();
      const res = await fetch(m.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cur.refreshToken, client_id: CLIENT_ID }),
      });
      if (!res.ok) {
        write(TOKENS_KEY, null);
        return null;
      }
      // 갱신은 사람이 다시 인증한 것이 아니다 — 인증 시각은 처음(또는 다시 본인확인한) 때의 것
      return store((await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }, cur.authTime);
    } catch {
      // 발급자에 닿지 못했다 — 쓰던 토큰으로 계속. 만료 뒤에도 대학 API 가 단절 유예로 받는다(D-67)
      unreachableUntil = Date.now() + 30_000;
      return cur;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** API 에 붙일 액세스 토큰. 30초 안에 끝나면 먼저 갱신한다. 로그인이 없거나 끝났으면 null */
export async function accessToken(): Promise<string | null> {
  const cur = read<Tokens>(TOKENS_KEY);
  if (!cur) return null;
  if (cur.expiresAt - Date.now() > 30_000) return cur.accessToken;
  const next = await refresh();
  if (!next) return null;
  // 갱신이 안 됐는데(발급자 단절) 토큰이 그대로면 만료됐어도 보낸다 — 받을지는 대학 API 가 정한다(단절 유예, D-67)
  return next.expiresAt > Date.now() || next.accessToken === cur.accessToken ? next.accessToken : null;
}

export function signedIn(): boolean {
  return read<Tokens>(TOKENS_KEY) !== null;
}

/**
 * 이 탭의 로그인을 끝낸다. 갱신 토큰을 발급자에 돌려보내(폐기) 다시 쓰지 못하게 하고, 다음 로그인은 비밀번호를 다시 묻게 한다.
 * @param navigate 발급자 로그아웃 화면을 거쳐 접수 홈으로(지원자가 직접 누른 로그아웃·"지금 종료")
 */
export async function logout(navigate: boolean): Promise<void> {
  const cur = read<Tokens>(TOKENS_KEY);
  write(TOKENS_KEY, null);
  write(FORCE_LOGIN_KEY, true);
  let m: Discovery | null = null;
  try {
    m = await meta();
  } catch {
    /* 발급자에 닿지 못해도 이 탭의 로그인은 이미 지웠다 */
  }
  if (cur?.refreshToken && m?.revocation_endpoint) {
    await fetch(m.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: cur.refreshToken, token_type_hint: 'refresh_token', client_id: CLIENT_ID }),
    }).catch(() => {});
  }
  if (navigate && m?.end_session_endpoint) {
    const url = new URL(m.end_session_endpoint);
    url.search = new URLSearchParams({
      client_id: CLIENT_ID,
      post_logout_redirect_uri: `${window.location.origin}/`,
      ...(cur?.idToken ? { id_token_hint: cur.idToken } : {}),
    }).toString();
    window.location.assign(url.toString());
  }
}
