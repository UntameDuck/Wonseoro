// 중앙 API + 대학 API(둘 다 AUTH_MODE=oidc) + 실제 로컬 발급자 — 같은 지원자 토큰으로 이어지는가 (T-M5-02 단계 4)
//
// 사용: 로컬 발급자(--profile auth)와 CI 재현 DB(:5499, univ_a·central)가 떠 있을 때
//       npm run build -w @wonseoro/contracts -w @wonseoro/server-kit -w @wonseoro/admission-api -w @wonseoro/central-api
//       npm run test:auth:central
// 이 스크립트가 중앙(:3112)·대학(:3111)을 oidc 로 띄운다. 지원자는 사람처럼 한 번 로그인하고 **같은 토큰**으로 둘 다 부른다.
//   - 중앙에 공통원서(출신 고교·졸업 연도)를 쓰고 이 대학에 내주기로 동의한다
//   - 대학에서 원서를 만들면, 대학이 토큰의 주체(sub)로 중앙에 Snapshot 을 요청해 그 값이 원서에 들어온다
//     → 두 API 가 같은 sub 를 가명 토큰으로 쓴다는 것이 끝에서 끝까지 확인된다
//   - 다른 지원자는 그 공통원서를 못 본다. 담당자 토큰·대학 전용 토큰은 중앙에서 거절된다
// 결과는 tests/auth/results/central-live-<시각>.json
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE, browserLogin, claims } from './helpers/login.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DB_HOST = process.env.AUTH_DB_HOST ?? 'localhost:5499';
const UNIV = 'UNIV-A';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const CENTRAL = 'http://localhost:3112';
const ADMISSION = 'http://localhost:3111';

const realm = (name) => JSON.parse(readFileSync(path.join(ROOT, 'infra/auth', `${name}.realm.json`), 'utf8'));
const staffRealm = realm('wonseoro-staff');
const applicantRealm = realm('wonseoro-applicant');
const cred = (r, username) => {
  const u = r.users.find((x) => x.username === username);
  const otp = u.credentials.find((c) => c.type === 'otp');
  return { username, password: u.credentials.find((c) => c.type === 'password').value, otpSecret: otp ? JSON.parse(otp.secretData).value : undefined };
};

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

async function call(base, method, url, token, body, extra = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json', 'idempotency-key': `live-${randomUUID()}` } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, json };
}

const quiet = {
  OTEL_METRICS_PORT: '0',
  CLOCK_AUTOSTART: 'false',
  PAYMENT_RECHECK_AUTOSTART: 'false',
  RECON_SCHEDULE_AUTOSTART: 'false',
  IDEMPOTENCY_PURGE_AUTOSTART: 'false',
  CENTRAL_GATE_AUTOSTART: 'false',
  S3_AUTO_CREATE_BUCKET: 'false',
  THROTTLE_MODE: 'off',
};
const procs = [];
const logs = {};
function start(name, entry, env) {
  const p = spawn(process.execPath, [path.join(ROOT, entry)], { env: { ...process.env, ...quiet, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  logs[name] = '';
  p.stdout.on('data', (d) => (logs[name] += d));
  p.stderr.on('data', (d) => (logs[name] += d));
  procs.push(p);
}
async function waitUp(url, name) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then((r) => r.status < 500, () => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} 가 뜨지 않았다\n${logs[name].slice(-1500)}`);
}

try {
  // 중앙에 이 대학이 등록돼 있어야 동의를 받는다(시험 준비)
  execFileSync('docker', ['exec', 'ci-pg', 'psql', '-q', '-U', 'wonseoro', '-d', 'central', '-c',
    `INSERT INTO kadmission_central.university_registry (id, name, status) VALUES ('${UNIV}', '가나대학교', 'ACTIVE') ON CONFLICT (id) DO NOTHING`]);

  start('central', 'apps/central-api/dist/main.js', {
    PORT: '3112',
    DATABASE_URL: `postgresql://wonseoro:wonseoro@${DB_HOST}/central`,
    AUTH_MODE: 'oidc',
    OIDC_APPLICANT_ISSUER: `${ISSUER_BASE}/realms/wonseoro-applicant`,
  });
  start('admission', 'apps/admission-api/dist/main.js', {
    PORT: '3111',
    UNIVERSITY_ID: UNIV,
    DATABASE_URL: `postgresql://kadmission_app:kadmission_app_dev@${DB_HOST}/univ_a`,
    CENTRAL_SYNC_URL: CENTRAL,
    AUTH_MODE: 'oidc',
    OIDC_APPLICANT_ISSUER: `${ISSUER_BASE}/realms/wonseoro-applicant`,
    OIDC_STAFF_ISSUER: `${ISSUER_BASE}/realms/wonseoro-staff`,
  });
  await waitUp(`${CENTRAL}/healthz`, 'central');
  await waitUp(`${ADMISSION}/api/v1/meta/time`, 'admission');

  const login = await browserLogin({
    realm: 'wonseoro-applicant', clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback', ...cred(applicantRealm, 'applicant-2'),
  });
  if (!login.tokens) throw new Error(`지원자 로그인 실패: ${login.error}`);
  const t = login.tokens.access_token;
  const auds = [claims(t).aud].flat();
  check(auds.includes('wonseoro-central-api') && auds.includes('wonseoro-admission-api'), `지원자 토큰 하나로 두 API 대상 — ${auds.join(',')}`);

  check((await call(CENTRAL, 'GET', '/api/v1/profile')).status === 401, '중앙: 토큰 없이는 공통원서를 못 본다');
  const school = `원서고등학교-${randomUUID().slice(0, 4)}`;
  const put = await call(CENTRAL, 'PUT', '/api/v1/profile', t, {
    fields: { highSchool: school, graduationYear: 2026 },
    consents: [{ universityId: UNIV, fieldCodes: ['highSchool', 'graduationYear'] }],
  });
  check(put.status === 200, `중앙: 실제 로그인 토큰으로 공통원서 저장·이 대학 동의 (${put.status})`);
  const mine = await call(CENTRAL, 'GET', '/api/v1/profile', t);
  check(mine.json.fields?.highSchool === school, '중앙: 내 공통원서를 다시 읽는다');

  const other = await browserLogin({
    realm: 'wonseoro-applicant', clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback', ...cred(applicantRealm, 'applicant-1'),
  });
  const theirs = await call(CENTRAL, 'GET', '/api/v1/profile', other.tokens?.access_token);
  check(theirs.status === 200 && theirs.json.fields?.highSchool !== school, '중앙: 다른 지원자는 내 공통원서를 못 본다');

  const staff = await browserLogin({
    realm: 'wonseoro-staff', clientId: 'admin-web', clientSecret: staffRealm.clients.find((c) => c.clientId === 'admin-web').secret,
    redirectUri: 'http://localhost:4100/auth/callback', ...cred(staffRealm, 'admin-a'),
  });
  check((await call(CENTRAL, 'GET', '/api/v1/profile', staff.tokens?.access_token)).status === 401, '중앙: 담당자 토큰은 지원자 API 에 못 쓴다');
  check((await call(CENTRAL, 'GET', '/api/v1/dashboard/applications', t)).status === 200, '중앙: "내 원서" 가 토큰으로 열린다');

  // 대학: 같은 토큰으로 원서를 만든다 → 대학이 토큰의 sub 로 중앙 Snapshot 을 받는다
  const made = await call(ADMISSION, 'POST', '/api/v1/applications', t, {
    cycleId: CYCLE, admissionTypeId: '22222222-2222-2222-2222-222222222222', departmentId: '33333333-3333-3333-3333-333333333333',
  });
  check(made.status === 201 || made.status === 200, `대학: 같은 토큰으로 원서 (${made.status})`);
  if (made.status === 201) {
    const app = await call(ADMISSION, 'GET', `/api/v1/applications/${made.json.id}`, t);
    check(JSON.stringify(app.json).includes(school), '대학 원서에 중앙 공통원서의 출신 고교가 들어왔다 — 두 API 가 같은 sub 로 이어진다');
  } else {
    // 재실행: 이미 있는 원서는 처음 만들 때의 Snapshot 을 갖는다
    const app = await call(ADMISSION, 'GET', `/api/v1/applications/${made.json.id}`, t);
    check(/원서고등학교/.test(JSON.stringify(app.json)), '대학 원서(재실행 — 처음 만들 때의 Snapshot)에 중앙 공통원서가 들어 있다');
  }
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  for (const p of procs) p.kill();
}

const result = {
  test: '중앙·대학 API oidc + 실제 로컬 발급자 — 같은 지원자 토큰으로 공통원서 Snapshot 이 이어진다 (T-M5-02 단계 4)',
  environment: '축소 환경 — 로컬 Keycloak 26.8.0·CI 재현 DB(:5499)·로컬 프로세스 둘',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `central-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 중앙·대학 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
