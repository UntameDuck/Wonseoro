// 토큰 검증기 + JWKS 캐시를 실제 로컬 발급자로 확인한다 (T-M5-02 단계 2, T-M3-06 Local JWKS Cache)
//
// 사용: (로컬 발급자가 떠 있을 때) npm run build -w @wonseoro/server-kit && npm run test:auth:verifier
//   1. 실제 로그인으로 받은 담당자·지원자 토큰을 server-kit OidcVerifier 로 검증한다
//   2. 담당자 토큰을 지원자 API 대상으로, 지원자 토큰을 담당자 렐름 검증기로 넣으면 거절된다
//   3. **발급자 컨테이너를 멈춘 채** 같은 검증기가 계속 검증한다(이미 받은 키)
//   4. 발급자가 멈춘 상태에서 **새로 뜬 검증기**도 스냅숏 파일의 키로 검증한다(Pod 재기동 흉내)
//   5. 발급자를 다시 띄운다
// 결과는 tests/auth/results/verifier-live-<시각>.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE, browserLogin } from './helpers/login.mjs';
import { workDir } from '../a11y/helpers/workdir.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { OidcVerifier, OidcTokenError } = require(path.join(ROOT, 'packages/server-kit/dist/index.js'));
const COMPOSE = ['compose', '-f', path.join(ROOT, 'infra/compose/docker-compose.dev.yml'), '--profile', 'auth'];

const realm = (name) => JSON.parse(readFileSync(path.join(ROOT, 'infra/auth', `${name}.realm.json`), 'utf8'));
const cred = (r, username) => {
  const u = r.users.find((x) => x.username === username);
  const otp = u.credentials.find((c) => c.type === 'otp');
  return { username, password: u.credentials.find((c) => c.type === 'password').value, otpSecret: otp ? JSON.parse(otp.secretData).value : undefined };
};
const staffRealm = realm('wonseoro-staff');
const applicantRealm = realm('wonseoro-applicant');

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};
/** 토큰 탓 거절(401)이면 그 이유, 통과하거나 다른 오류면 null */
const rejection = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof OidcTokenError ? e.problem : null;
  }
};

const snapDir = workDir('auth');
const snapshotFile = path.join(snapDir, `jwks-staff-${Date.now()}.json`);
const staffIssuer = `${ISSUER_BASE}/realms/wonseoro-staff`;
const applicantIssuer = `${ISSUER_BASE}/realms/wonseoro-applicant`;
let stopped = false;

try {
  const staffLogin = await browserLogin({
    realm: 'wonseoro-staff', clientId: 'admin-web', clientSecret: staffRealm.clients.find((c) => c.clientId === 'admin-web').secret,
    redirectUri: 'http://localhost:4100/auth/callback', ...cred(staffRealm, 'admin-a'),
  });
  const applicantLogin = await browserLogin({
    realm: 'wonseoro-applicant', clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback', ...cred(applicantRealm, 'applicant-1'),
  });
  if (!staffLogin.tokens || !applicantLogin.tokens) throw new Error(`로그인 실패: ${staffLogin.error ?? ''} ${applicantLogin.error ?? ''}`);
  const staffToken = staffLogin.tokens.access_token;
  const applicantToken = applicantLogin.tokens.access_token;

  const staffVerifier = new OidcVerifier({ issuer: staffIssuer, audience: 'wonseoro-admission-api', snapshotFile });
  const applicantVerifier = new OidcVerifier({ issuer: applicantIssuer, audience: 'wonseoro-central-api' });

  const s = await staffVerifier.verify(staffToken);
  check(s.roles.includes('admission-admin') && s.acr === 'mfa' && typeof s.authTime === 'number', `실제 담당자 토큰 검증 — 역할 ${s.roles.join(',')}, 수준 ${s.acr}`);
  const a = await applicantVerifier.verify(applicantToken);
  check(a.roles.length === 0 && a.subject.length > 0, '실제 지원자 토큰 검증 — 역할 없음, 주체 있음');

  // 렐름마다 서명 키가 달라 다른 렐름 토큰은 키 단계(unknown-key)에서, 키가 같아도 발급자 단계에서 막힌다
  const r1 = await rejection(applicantVerifier.verify(staffToken));
  check(r1, `담당자 토큰은 지원자 렐름 검증기를 통과하지 못한다 — ${r1}`);
  const r2 = await rejection(staffVerifier.verify(applicantToken));
  check(r2, `지원자 토큰은 담당자 렐름 검증기를 통과하지 못한다 — ${r2}`);
  const centralStaff = new OidcVerifier({ issuer: staffIssuer, audience: 'wonseoro-central-api' });
  const r3 = await rejection(centralStaff.verify(staffToken));
  check(r3 === 'invalid-claims', `담당자 토큰은 중앙 API 대상이 아니다(aud) — ${r3}`);

  // 발급자를 멈춘다
  execFileSync('docker', [...COMPOSE, 'stop', 'keycloak'], { stdio: 'ignore' });
  stopped = true;
  const down = await fetch(`${staffIssuer}/.well-known/openid-configuration`).then(() => false, () => true);
  check(down, '발급자 컨테이너가 멈췄다(연결 거부)');

  const again = await staffVerifier.verify(staffToken);
  check(again.subject === s.subject, '발급자가 멈춘 뒤에도 같은 검증기가 이미 받은 키로 검증한다');
  await staffVerifier.jwks.refresh();
  check(staffVerifier.status().lastError && staffVerifier.status().keyCount > 0, `다시 받기 실패는 기록하고 키는 버리지 않는다 — ${staffVerifier.status().lastError}`);

  const restarted = new OidcVerifier({ issuer: staffIssuer, audience: 'wonseoro-admission-api', snapshotFile });
  const fromSnap = await restarted.verify(staffToken);
  check(fromSnap.subject === s.subject && restarted.status().source === 'snapshot', '발급자 장애 중 새로 뜬 검증기도 스냅숏의 키로 검증한다(Pod 재기동)');

  const cold = new OidcVerifier({ issuer: staffIssuer, audience: 'wonseoro-admission-api' });
  let coldResult = 'passed';
  try {
    await cold.verify(staffToken);
  } catch (e) {
    coldResult = e.name;
  }
  check(coldResult === 'OidcUnavailableError', `스냅숏도 없으면 판단할 수 없다고 답한다(503) — ${coldResult}`);
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  if (stopped) {
    execFileSync('docker', [...COMPOSE, 'start', 'keycloak'], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      up = await fetch(`${staffIssuer}/.well-known/openid-configuration`).then((r) => r.ok, () => false);
    }
    check(up, '발급자를 다시 띄웠다');
  }
  rmSync(snapshotFile, { force: true });
}

const result = {
  test: '토큰 검증기·JWKS 캐시 — 실제 로컬 발급자와 발급자 정지 (T-M5-02 단계 2, T-M3-06)',
  environment: '축소 환경 — 로컬 Keycloak 26.8.0(start-dev)·로컬 프로세스',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `verifier-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 검증기 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
