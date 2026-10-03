// 로컬 OIDC 발급자 확인 (T-M5-02·10 단계 1, docs/12-authentication-plan.md)
//
// 사용: docker compose -f infra/compose/docker-compose.dev.yml --profile auth up -d keycloak
//       npm run test:auth:issuer
// 사람이 브라우저로 하는 로그인 길(PKCE → 비밀번호 → OTP → code 교환)을 그대로 밟고, 받은 토큰을 본다.
//   - 담당자: 비밀번호만으로는 토큰이 안 나온다(OTP 필수), 토큰에 역할·대상(aud)·인증 수준(acr)·인증 시각(auth_time)
//   - 5분 안의 재요청은 OTP 를 다시 묻지 않고, 다시 인증(max_age=0)을 요구하면 비밀번호·OTP 를 다시 묻는다(step-up)
//   - 비활성 break-glass 계정은 로그인되지 않는다
//   - 지원자: 역할 없음, 대학·중앙 API 둘 다 대상
// 시험 계정·비밀은 렐름 파일(infra/auth/*.realm.json)에서 읽는다. 결과는 tests/auth/results/local-issuer-<시각>.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE, browserLogin, claims } from './helpers/login.mjs';
import { freshTotp } from './helpers/totp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const realmFile = (name) => JSON.parse(readFileSync(path.join(ROOT, 'infra/auth', `${name}.realm.json`), 'utf8'));
const staff = realmFile('wonseoro-staff');
const applicant = realmFile('wonseoro-applicant');
const account = (realm, username) => {
  const u = realm.users.find((x) => x.username === username);
  const password = u.credentials.find((c) => c.type === 'password').value;
  const otp = u.credentials.find((c) => c.type === 'otp');
  return { username, password, otpSecret: otp ? JSON.parse(otp.secretData).value : undefined };
};
const adminWeb = staff.clients.find((c) => c.clientId === 'admin-web');
const STAFF = { realm: 'wonseoro-staff', clientId: 'admin-web', clientSecret: adminWeb.secret, redirectUri: 'http://localhost:4100/auth/callback' };
const APPLICANT = { realm: 'wonseoro-applicant', clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback' };

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

try {
  // 1. 발급자 메타데이터·키
  for (const realm of ['wonseoro-staff', 'wonseoro-applicant']) {
    const meta = await (await fetch(`${ISSUER_BASE}/realms/${realm}/.well-known/openid-configuration`)).json();
    const jwks = await (await fetch(meta.jwks_uri)).json();
    const sig = jwks.keys.filter((k) => k.use === 'sig');
    check(meta.issuer === `${ISSUER_BASE}/realms/${realm}` && sig.some((k) => k.alg === 'RS256' && k.kid),
      `${realm}: discovery·JWKS — 서명 키 ${sig.map((k) => k.alg).join(',')}`);
    check(meta.code_challenge_methods_supported?.includes('S256'), `${realm}: PKCE S256 지원`);
  }

  // 2. 담당자 로그인 — 비밀번호 + OTP
  const a = account(staff, 'admin-a');
  const first = await browserLogin({ ...STAFF, ...a });
  check(first.tokens && first.steps.join('>') === 'password>otp>redirect', `담당자 로그인이 비밀번호 → OTP 를 거친다 (${first.steps.join(' > ')}${first.error ? ` · ${first.error}` : ''})`);
  if (first.tokens) {
    const c = claims(first.tokens.access_token);
    check(c.iss === `${ISSUER_BASE}/realms/wonseoro-staff`, '토큰 발급자(iss)가 담당자 렐름이다');
    check([c.aud].flat().includes('wonseoro-admission-api'), `대상(aud)에 대학 API — ${[c.aud].flat().join(',')}`);
    check(JSON.stringify(c.roles) === JSON.stringify(['admission-admin']), `역할 클레임(roles) — ${JSON.stringify(c.roles)}`);
    check(c.acr === 'mfa', `인증 수준(acr) mfa = 비밀번호+OTP — ${c.acr}`);
    check(typeof c.auth_time === 'number' && Math.abs(c.auth_time * 1000 - Date.now()) < 120_000, '인증 시각(auth_time)이 있다 — step-up 판단에 쓴다');
    check(c.exp - c.iat === 300, `액세스 토큰 수명 5분 — ${c.exp - c.iat}초`);
    check(typeof c.sub === 'string' && c.sub.length > 0, '주체(sub)가 있다 — 2인 승인·감사의 담당자 식별');

    // 3. 같은 브라우저(SSO 쿠키) 5분 안 재요청 — OTP 를 다시 묻지 않는다
    const again = await browserLogin({ ...STAFF, ...a, jar: first.jar });
    check(again.tokens && again.steps.join('>') === 'redirect' && claims(again.tokens.access_token).acr === 'mfa',
      `5분 안 재요청은 화면 없이 통과하고 수준 mfa 유지 (${again.steps.join(' > ')})`);

    // 4. 민감 동작 전 다시 인증 — max_age=0 이면 비밀번호·OTP 를 다시.
    //    발급자는 초 단위로 "인증 뒤 지난 시간 > max_age" 를 본다 — 첫 로그인과 같은 초 안이면 0 > 0 이 아니라 다시 묻지 않는다.
    //    사람은 같은 초에 다시 누르지 않는다. 시험이 너무 빨라 생기는 차이라 1초 넘게 기다린다
    await new Promise((r) => setTimeout(r, 1100));
    const stepUp = await browserLogin({ ...STAFF, ...a, jar: first.jar, extra: { max_age: '0' } });
    const s = stepUp.tokens ? claims(stepUp.tokens.access_token) : {};
    check(stepUp.tokens && stepUp.steps.includes('otp') && s.acr === 'mfa' && s.auth_time >= c.auth_time,
      `다시 인증(max_age=0)은 OTP 를 다시 묻고 인증 시각이 새로 찍힌다 (${stepUp.steps.join(' > ')})`);
  }

  // 5. OTP 가 틀리면 토큰이 없다 — 잠금 정책이 다른 확인을 막지 않게 조회자 계정으로 한 번만
  const wrong = await browserLogin({ ...STAFF, ...account(staff, 'viewer'), otpSecret: 'not-the-secret' });
  check(!wrong.tokens, `틀린 OTP 로는 토큰이 나오지 않는다 (${wrong.error ?? '토큰 발급됨'})`);

  // 6. 다른 역할 — 감사자
  const aud = await browserLogin({ ...STAFF, ...account(staff, 'auditor') });
  check(aud.tokens && JSON.stringify(claims(aud.tokens.access_token).roles) === JSON.stringify(['security-auditor']), '감사자 토큰의 역할은 security-auditor 하나다');

  // 7. 비활성 break-glass
  const bg = await browserLogin({ ...STAFF, ...account(staff, 'breakglass') });
  check(!bg.tokens, `비활성 break-glass 계정은 로그인되지 않는다 (${bg.error ?? '토큰 발급됨'})`);

  // 8. 개발 시험용 직접 발급도 OTP 를 요구한다
  const direct = (extra) =>
    fetch(`${ISSUER_BASE}/realms/wonseoro-staff/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: 'wonseoro-dev-cli', username: a.username, password: a.password, scope: 'openid', ...extra }),
    });
  const noOtp = await direct({});
  check(!noOtp.ok, `시험용 직접 발급도 OTP 없이는 거절한다 (${noOtp.status})`);
  const withOtp = await direct({ totp: await freshTotp(a.otpSecret) });
  check(withOtp.ok, `시험용 직접 발급은 OTP 를 함께 주면 된다 (${withOtp.status})`);

  // 9. 지원자
  const ap = await browserLogin({ ...APPLICANT, ...account(applicant, 'applicant-1') });
  check(ap.tokens && ap.steps.join('>') === 'password>redirect', `지원자 로그인 (${ap.steps.join(' > ')}${ap.error ? ` · ${ap.error}` : ''})`);
  if (ap.tokens) {
    const c = claims(ap.tokens.access_token);
    const auds = [c.aud].flat();
    check(auds.includes('wonseoro-admission-api') && auds.includes('wonseoro-central-api'), `지원자 토큰 대상 — ${auds.join(',')}`);
    check(!c.roles || c.roles.length === 0, '지원자 토큰에는 담당자 역할이 없다');
    check(typeof c.sub === 'string' && c.sub.length > 0, '지원자 주체(sub) — 가명 토큰으로 쓴다');
    check(c.iss === `${ISSUER_BASE}/realms/wonseoro-applicant`, '지원자 토큰 발급자는 지원자 렐름 — 담당자 렐름과 섞이지 않는다');
  }
} catch (err) {
  check(false, `중단: ${err.message}`);
}

const result = {
  test: '로컬 OIDC 발급자 — 로그인 길·토큰 내용 (T-M5-02·10 단계 1)',
  environment: '축소 환경 — 로컬 Keycloak 26.8.0(start-dev, 내장 DB)',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `local-issuer-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 로컬 발급자 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
