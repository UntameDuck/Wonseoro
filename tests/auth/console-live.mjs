// 운영 콘솔 관리자 로그인(BFF) — 실제 콘솔 서버 + 대학 API(oidc) + 로컬 발급자 (T-M5-10 단계 5)
//
// 사용: 로컬 발급자(--profile auth)·CI 재현 DB(:5499) 와 미리보기 서버 `auth-admission`(:3111)·`auth-admin`(:4100) 이 떠 있을 때
//       npm run test:auth:console
// 브라우저가 하는 그대로(리디렉트·쿠키) 콘솔 → 발급자 → 콘솔 콜백을 밟는다. 쿠키는 호스트별로 따로 든다.
//   - 로그인 전: 운영 API 중계 401, 세션 없음
//   - 로그인: 인증 수준 mfa 요청·PKCE, 콜백이 세션 쿠키(HttpOnly·SameSite=Lax)를 주고 로그인용 쿠키를 지운다, 쿠키 안에 토큰이 평문으로 없다
//   - 세션으로 운영 API, 콘솔 화면 표시가 아닌 요청(x-requested-with 없음) 403, 꾸민 쿠키 401, 다른 사이트로 돌려보내기 거절, state 위조 실패
//   - 액세스 토큰이 끝나 가면 갱신 토큰으로 바꿔 쿠키를 새로 준다(인증 시각은 그대로)
//   - 감사자는 증적 경로, 설정 403 / 로그아웃은 발급자 로그아웃 주소를 주고 세션을 지운다
// 결과는 tests/auth/results/console-live-<시각>.json
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshTotp } from './helpers/totp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONSOLE = 'http://localhost:4100';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, 'scripts/auth/env/admin.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const staff = JSON.parse(readFileSync(path.join(ROOT, 'infra/auth/wonseoro-staff.realm.json'), 'utf8'));
const cred = (username) => {
  const u = staff.users.find((x) => x.username === username);
  return { username, password: u.credentials.find((c) => c.type === 'password').value, otpSecret: JSON.parse(u.credentials.find((c) => c.type === 'otp').secretData).value };
};

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

/** 호스트별 쿠키 — 브라우저처럼 콘솔 쿠키는 콘솔에만, 발급자 쿠키는 발급자에만 */
class Browser {
  jar = new Map();
  lastSetCookie = [];
  cookie(host, name) {
    return this.jar.get(host)?.get(name);
  }
  set(host, name, value) {
    if (!this.jar.has(host)) this.jar.set(host, new Map());
    this.jar.get(host).set(name, value);
  }
  async go(url, init = {}) {
    const u = new URL(url);
    const cookies = [...(this.jar.get(u.host) ?? new Map())].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(u, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookies ? { cookie: cookies } : {}) } });
    this.lastSetCookie = res.headers.getSetCookie?.() ?? [];
    for (const line of this.lastSetCookie) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1);
      const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '';
      if (!this.jar.has(u.host)) this.jar.set(u.host, new Map());
      if (expired) this.jar.get(u.host).delete(name);
      else this.jar.get(u.host).set(name, value);
    }
    return res;
  }
}

const formAction = (html) => html.match(/<form[^>]*action="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');

/** 콘솔 로그인 버튼부터 콜백까지. 마지막 응답(콘솔로 돌아온 303)과 거친 단계 */
async function login(b, who, { returnTo = '/config', stepUp = false } = {}) {
  const c = cred(who);
  const trail = [];
  let res = await b.go(`${CONSOLE}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}${stepUp ? '&stepUp=1' : ''}`);
  const authorize = new URL(res.headers.get('location'));
  trail.push({ authorize });
  res = await b.go(authorize);
  for (let hop = 0; hop < 8; hop++) {
    if (res.status === 302 || res.status === 303) {
      const loc = new URL(res.headers.get('location'), authorize);
      if (loc.origin === CONSOLE) {
        res = await b.go(loc); // 콘솔 콜백
        trail.push({ callback: loc, callbackSetCookie: b.lastSetCookie });
        return { res, trail };
      }
      res = await b.go(loc);
      continue;
    }
    const html = await res.text();
    const action = formAction(html);
    if (/name="password"/.test(html)) res = await b.go(action, { method: 'POST', body: new URLSearchParams({ username: c.username, password: c.password, credentialId: '' }) });
    else if (/name="otp"/.test(html)) res = await b.go(action, { method: 'POST', body: new URLSearchParams({ otp: await freshTotp(c.otpSecret) }) });
    else throw new Error(`발급자 화면을 알 수 없다 (${res.status})`);
    trail.push({ form: /name="otp"/.test(html) ? 'otp' : 'password' });
  }
  throw new Error('콜백에 닿지 못했다');
}

const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

// 콘솔 세션 쿠키를 시험이 직접 풀어 만료 직전으로 바꾼다 — 갱신 경로를 기다리지 않고 확인하려고 (비밀은 로컬 시험값)
const key = createHash('sha256').update(`wonseoro-admin-session:${env.ADMIN_SESSION_SECRET}`).digest();
const unseal = (s) => {
  const raw = Buffer.from(s, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
};
const seal = (v) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
};

try {
  const host = new URL(CONSOLE).host;
  const b = new Browser();

  // 로그인 전
  const anon = await b.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`);
  check(anon.status === 401 && (await json(anon)).code === 'UNAUTHENTICATED', `로그인 전 운영 API 중계는 401 (${anon.status})`);
  const s0 = await json(await b.go(`${CONSOLE}/api/session`));
  check(s0.mode === 'oidc' && s0.operator === null, '로그인 전 세션 없음(관리자 로그인 모드)');

  // 로그인
  const { res: back, trail } = await login(b, 'admin-a');
  const authorize = trail[0].authorize;
  check(authorize.searchParams.get('acr_values') === 'mfa' && authorize.searchParams.get('code_challenge_method') === 'S256' && authorize.searchParams.get('nonce'),
    '로그인 요청이 인증 수준 mfa·PKCE·nonce 를 싣는다');
  check(trail.some((t) => t.form === 'password') && trail.some((t) => t.form === 'otp'), '발급자가 비밀번호와 일회용 번호를 차례로 묻는다');
  const cb = trail.find((t) => t.callback);
  const sessionLine = cb.callbackSetCookie.find((l) => l.startsWith('wonseoro_admin_session='));
  check(back.status === 303 && back.headers.get('location') === '/config' || new URL(back.headers.get('location') ?? '', CONSOLE).pathname === '/config',
    `콜백이 원래 화면(/config)으로 돌려보낸다 (${back.headers.get('location')})`);
  check(/httponly/i.test(sessionLine ?? '') && /samesite=lax/i.test(sessionLine ?? ''), '세션 쿠키는 HttpOnly·SameSite=Lax');
  check(cb.callbackSetCookie.some((l) => /^wonseoro_admin_login=;/.test(l) || (/^wonseoro_admin_login=/.test(l) && /max-age=0|expires=thu, 01 jan 1970/i.test(l))),
    '로그인용 쿠키(state·PKCE)는 콜백에서 지운다');
  const raw = b.cookie(host, 'wonseoro_admin_session');
  check(raw && !raw.includes('eyJ') && !Buffer.from(raw, 'base64url').toString('latin1').includes('eyJ'), '쿠키 안에 토큰이 평문으로 없다(암호화)');

  const s1 = await json(await b.go(`${CONSOLE}/api/session`));
  check(s1.operator === 'admin-a' && s1.roles?.includes('admission-admin') && !('accessToken' in s1), `세션 정보 — ${s1.name} (${s1.operator}), 토큰은 주지 않는다`);
  const cfg = await b.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`);
  check(cfg.status === 200, `로그인한 담당자의 운영 API 중계 (${cfg.status})`);

  const noHeader = await b.go(`${CONSOLE}/api/admin/deadline-policies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check(noHeader.status === 403, `콘솔 화면 표시(x-requested-with) 없는 상태 변경 요청은 403 (${noHeader.status})`);

  // 갱신 — 액세스 토큰이 끝나 가는 세션
  const sess = unseal(raw);
  b.set(host, 'wonseoro_admin_session', seal({ ...sess, expiresAt: Date.now() + 5_000 }));
  const renewed = await b.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`);
  const after = unseal(b.cookie(host, 'wonseoro_admin_session'));
  check(renewed.status === 200 && after.accessToken !== sess.accessToken && after.expiresAt > Date.now() + 60_000 && after.authTime === sess.authTime,
    '액세스 토큰이 끝나 가면 갱신 토큰으로 바꿔 쿠키를 새로 준다 — 인증 시각은 그대로');

  // 꾸민 쿠키
  const forged = new Browser();
  forged.set(host, 'wonseoro_admin_session', `${raw.slice(0, -4)}AAAA`);
  check((await forged.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`)).status === 401, '꾸민 세션 쿠키는 401');

  // 다른 사이트로 돌려보내기 거절
  const b2 = new Browser();
  const { res: evil } = await login(b2, 'auditor', { returnTo: '//evil.example/steal' });
  check(new URL(evil.headers.get('location'), CONSOLE).origin === CONSOLE, `로그인 뒤 돌아갈 곳이 다른 사이트면 콘솔 첫 화면으로 (${evil.headers.get('location')})`);
  // 감사자 — 증적 경로는 통과, 설정은 403
  const ev = await b2.go(`${CONSOLE}/api/admin/evidence/applications/00000000-0000-4000-8000-000000000000?reason=${encodeURIComponent('감사')}`);
  check(ev.status !== 401 && ev.status !== 403, `감사자는 증적 경로를 통과한다 (${ev.status})`);
  check((await b2.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`)).status === 403, '감사자의 설정 조회는 운영 API 가 403');

  // state 위조
  const b3 = new Browser();
  await b3.go(`${CONSOLE}/api/auth/login?returnTo=/`);
  const bad = await b3.go(`${CONSOLE}/auth/callback?code=x&state=forged`);
  check(new URL(bad.headers.get('location'), CONSOLE).searchParams.get('login') === 'failed', 'state 가 다른 콜백은 로그인 실패로 돌려보낸다');

  // 재인증 요청은 max_age=0
  const b4 = new Browser();
  const r4 = await b4.go(`${CONSOLE}/api/auth/login?returnTo=/deadline&stepUp=1`);
  check(new URL(r4.headers.get('location')).searchParams.get('max_age') === '0', '본인 확인 다시 하기는 발급자에 max_age=0 으로 요청한다');

  // 로그아웃
  const out = await b.go(`${CONSOLE}/api/auth/logout`, { method: 'POST', headers: { 'x-requested-with': 'wonseoro-admin' } });
  const outBody = await json(out);
  check(out.status === 200 && /\/protocol\/openid-connect\/logout\?/.test(outBody.logoutUrl ?? ''), '로그아웃은 발급자 로그아웃 주소를 준다');
  check((await b.go(`${CONSOLE}/api/admin/config/active?cycleId=${CYCLE}`)).status === 401, '로그아웃 뒤 운영 API 중계는 401');
  const noForm = await new Browser().go(`${CONSOLE}/api/auth/logout`, { method: 'POST' });
  check(noForm.status === 403, '콘솔 화면이 아닌 로그아웃 요청은 403');
} catch (err) {
  check(false, `중단: ${err.message}`);
}

const result = {
  test: '운영 콘솔 관리자 로그인(BFF) — 실제 콘솔 서버·대학 API·로컬 발급자 (T-M5-10 단계 5)',
  environment: '축소 환경 — next dev(:4100)·admission-api(:3111, oidc)·로컬 Keycloak 26.8.0·CI 재현 DB(:5499)',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `console-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 콘솔 로그인 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
