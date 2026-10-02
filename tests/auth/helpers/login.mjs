// 로컬 발급자(Keycloak)에 사람이 브라우저로 로그인하는 길을 fetch 로 그대로 밟는다.
// 인가 요청(PKCE) → 비밀번호 화면 → (담당자면) OTP 화면 → 콜백의 code → 토큰 교환.
// 화면 HTML 에서 form action 만 읽는다 — 화면 문구에 기대지 않는다.
import { createHash, randomBytes } from 'node:crypto';
import { freshTotp } from './totp.mjs';

export const ISSUER_BASE = process.env.AUTH_ISSUER_BASE ?? 'http://localhost:18080';

export function claims(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

class Jar {
  #c = new Map();
  take(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      this.#c.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  header() {
    return [...this.#c].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const formAction = (html) => {
  const m = html.match(/<form[^>]*action="([^"]+)"/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
};

/**
 * @param {{ realm: string, clientId: string, clientSecret?: string, redirectUri: string,
 *           username: string, password: string, otpSecret?: string, extra?: Record<string,string>, jar?: Jar }} o
 * @returns {Promise<{ tokens?: any, steps: string[], error?: string, jar: Jar }>}
 */
export async function browserLogin(o) {
  const jar = o.jar ?? new Jar();
  const steps = [];
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const realmUrl = `${ISSUER_BASE}/realms/${o.realm}`;
  const auth = new URL(`${realmUrl}/protocol/openid-connect/auth`);
  for (const [k, v] of Object.entries({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: 'openid',
    state: randomBytes(8).toString('hex'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(o.extra ?? {}),
  })) auth.searchParams.set(k, v);

  const go = async (url, init = {}) => {
    const res = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie: jar.header() } });
    jar.take(res);
    return res;
  };

  let res = await go(auth);
  let code = null;
  let last = null;
  for (let hop = 0; hop < 6 && !code; hop++) {
    if (res.status === 302 || res.status === 303) {
      const loc = new URL(res.headers.get('location'), auth);
      if (loc.href.startsWith(o.redirectUri.replace(/\*$/, ''))) {
        code = loc.searchParams.get('code');
        if (!code) return { steps, error: loc.searchParams.get('error') ?? 'no-code', jar };
        steps.push('redirect');
        break;
      }
      res = await go(loc);
      continue;
    }
    const html = await res.text();
    const action = formAction(html);
    if (!action) return { steps, error: `form 없음(${res.status})`, jar };
    const form = /name="password"/.test(html) ? 'password' : /name="otp"/.test(html) ? 'otp' : null;
    // 같은 화면이 다시 나오면 발급자가 입력을 거절한 것이다 — 다시 넣지 않는다(잠금 정책을 건드리지 않게)
    if (form && form === last) return { steps, error: `${form} 거절`, jar };
    last = form;
    if (form === 'password') {
      steps.push('password');
      res = await go(action, { method: 'POST', body: new URLSearchParams({ username: o.username, password: o.password, credentialId: '' }) });
    } else if (form === 'otp') {
      steps.push('otp');
      if (!o.otpSecret) return { steps, error: 'otp 요구됨', jar };
      res = await go(action, { method: 'POST', body: new URLSearchParams({ otp: await freshTotp(o.otpSecret) }) });
    } else {
      return { steps, error: `알 수 없는 화면(${res.status})`, jar };
    }
  }
  if (!code) return { steps, error: '콜백에 닿지 못함', jar };

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: o.redirectUri,
    client_id: o.clientId,
    code_verifier: verifier,
    ...(o.clientSecret ? { client_secret: o.clientSecret } : {}),
  });
  const tok = await fetch(`${realmUrl}/protocol/openid-connect/token`, { method: 'POST', body });
  const tokens = await tok.json();
  if (!tok.ok) return { steps, error: tokens.error ?? `token ${tok.status}`, jar };
  return { tokens, steps, jar };
}
