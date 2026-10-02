// 대학 API(AUTH_MODE=oidc) + 실제 로컬 발급자 끝에서 끝까지 (T-M5-02·10 단계 3)
//
// 사용: 로컬 발급자(--profile auth)와 CI 재현 DB(:5499, HANDOFF §3)가 떠 있을 때
//       npm run build -w @wonseoro/contracts -w @wonseoro/server-kit -w @wonseoro/admission-api && npm run test:auth:api
// 이 스크립트가 admission-api 를 oidc 모드로 직접 띄운다(:3111). 사람이 하는 로그인(PKCE → 비밀번호 → OTP)으로 받은
// Keycloak 토큰을 그대로 보낸다 — 단위 시험의 손으로 만든 토큰이 실제 토큰과 같은 모양인지(aud·acr·roles·preferred_username) 여기서 확인된다.
// 결과는 tests/auth/results/api-live-<시각>.json
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE, browserLogin } from './helpers/login.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.AUTH_API_PORT ?? 3111);
const API = `http://localhost:${PORT}`;
const DB = process.env.AUTH_API_DB ?? 'postgresql://kadmission_app:kadmission_app_dev@localhost:5499/univ_a';
const CYCLE = '11111111-1111-1111-1111-111111111111';

const realm = (name) => JSON.parse(readFileSync(path.join(ROOT, 'infra/auth', `${name}.realm.json`), 'utf8'));
const staffRealm = realm('wonseoro-staff');
const applicantRealm = realm('wonseoro-applicant');
const cred = (r, username) => {
  const u = r.users.find((x) => x.username === username);
  const otp = u.credentials.find((c) => c.type === 'otp');
  return { username, password: u.credentials.find((c) => c.type === 'password').value, otpSecret: otp ? JSON.parse(otp.secretData).value : undefined };
};
const staffLogin = (username) =>
  browserLogin({
    realm: 'wonseoro-staff', clientId: 'admin-web', clientSecret: staffRealm.clients.find((c) => c.clientId === 'admin-web').secret,
    redirectUri: 'http://localhost:4100/auth/callback', ...cred(staffRealm, username),
  });
const applicantLogin = (username) =>
  browserLogin({ realm: 'wonseoro-applicant', clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback', ...cred(applicantRealm, username) });

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

async function call(method, url, token, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json', 'idempotency-key': `live-${randomUUID()}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, json, www: res.headers.get('www-authenticate') };
}

const api = spawn(process.execPath, [path.join(ROOT, 'apps/admission-api/dist/main.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    UNIVERSITY_ID: 'UNIV-A',
    DATABASE_URL: DB,
    AUTH_MODE: 'oidc',
    OIDC_APPLICANT_ISSUER: `${ISSUER_BASE}/realms/wonseoro-applicant`,
    OIDC_STAFF_ISSUER: `${ISSUER_BASE}/realms/wonseoro-staff`,
    OTEL_METRICS_PORT: '9481',
    CLOCK_AUTOSTART: 'false',
    PAYMENT_RECHECK_AUTOSTART: 'false',
    RECON_SCHEDULE_AUTOSTART: 'false',
    IDEMPOTENCY_PURGE_AUTOSTART: 'false',
    CENTRAL_GATE_AUTOSTART: 'false',
    S3_AUTO_CREATE_BUCKET: 'false',
    THROTTLE_MODE: 'off',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
api.stdout.on('data', (d) => (log += d));
api.stderr.on('data', (d) => (log += d));

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${API}/api/v1/meta/time`).then((r) => r.ok, () => false);
  }
  if (!up) throw new Error(`API 가 뜨지 않았다\n${log.slice(-2000)}`);
  check(/OIDC 검증/.test(log), 'API 가 oidc 모드로 떴다(기동 로그)');

  // 지원자
  const a1 = await applicantLogin('applicant-1');
  const a2 = await applicantLogin('applicant-2');
  if (!a1.tokens || !a2.tokens) throw new Error(`지원자 로그인 실패 ${a1.error ?? ''} ${a2.error ?? ''}`);
  const t1 = a1.tokens.access_token;
  const t2 = a2.tokens.access_token;

  const PROTECTED = `/api/v1/applications/${randomUUID()}`;
  const anon = await call('GET', PROTECTED);
  check(anon.status === 401 && anon.json.code === 'UNAUTHENTICATED', `토큰 없는 지원자 요청은 401 (${anon.status} ${anon.json.code})`);
  const cyc = await call('GET', '/api/v1/admission-cycles/current');
  check(cyc.status === 200, `모집 정보는 로그인 전에도 보인다(공개, D-65) (${cyc.status})`);
  const made = await call('POST', '/api/v1/applications', t1, {
    cycleId: CYCLE, admissionTypeId: '22222222-2222-2222-2222-222222222222', departmentId: '33333333-3333-3333-3333-333333333333',
  });
  // 다시 돌리면 같은 지원자의 같은 전형 원서가 이미 있어 그 원서를 돌려준다(200, D-29)
  const appId = made.json.id;
  check((made.status === 201 || made.status === 200) && appId, `지원자가 원서를 만든다(재실행이면 있던 원서) (${made.status})`);
  if (appId) {
    check((await call('GET', `/api/v1/applications/${appId}`, t1)).status === 200, '내 원서는 열린다');
    check((await call('GET', `/api/v1/applications/${appId}`, t2)).status === 404, '다른 지원자는 같은 원서를 못 본다(404)');
  }
  const staffOnApplicant = await staffLogin('admin-a');
  if (!staffOnApplicant.tokens) throw new Error(`담당자 로그인 실패 ${staffOnApplicant.error}`);
  const adminA = staffOnApplicant.tokens.access_token;
  check((await call('GET', PROTECTED, adminA)).status === 401, '담당자 토큰으로는 지원자 API 를 못 쓴다');
  check((await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, t1)).status === 401, '지원자 토큰으로는 운영 API 를 못 쓴다');

  // 담당자 — 역할별
  const cfg = await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, adminA);
  check(cfg.status === 200, `입학처 담당자(비밀번호+OTP)는 설정을 본다 (${cfg.status})`);
  const ev = await call('GET', `/admin/v1/evidence/applications/${randomUUID()}?reason=${encodeURIComponent('확인')}`, adminA);
  check(ev.status === 403, `입학처 담당자는 증적(감사 범위)을 못 연다 (${ev.status})`);

  const auditor = (await staffLogin('auditor')).tokens?.access_token;
  const evA = await call('GET', `/admin/v1/evidence/applications/${randomUUID()}?reason=${encodeURIComponent('감사 확인')}`, auditor);
  check(evA.status !== 401 && evA.status !== 403, `감사자는 증적 경로를 통과한다(방금 로그인) — ${evA.status}`);
  check((await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, auditor)).status === 403, '감사자는 설정을 못 본다(403)');

  for (const who of ['viewer', 'sre', 'release']) {
    const t = (await staffLogin(who)).tokens?.access_token;
    const s = (await call('GET', `/admin/v1/config/active?cycleId=${CYCLE}`, t)).status;
    check(s === 403, `${who} 역할은 업무 API 를 못 쓴다 (${s})`);
  }

  // 2인 승인 — 실제 토큰의 담당자 이름(preferred_username)으로 기록된다
  const draft = await call('POST', '/admin/v1/deadline-policies', adminA, {
    cycleId: CYCLE, version: `live-${randomUUID().slice(0, 8)}`, mode: 'FINALIZED_COMMIT_BEFORE_DEADLINE', deadlineAt: '2099-12-31T09:00:00Z',
  });
  const policyId = draft.json.policyId;
  const history = async () => (await call('GET', `/admin/v1/deadline-policies?cycleId=${CYCLE}`, adminA)).json.policies?.find((p) => p.policyId === policyId);
  const mine = await history();
  check(draft.status === 201 && mine?.createdBy === 'admin-a', `마감 정책 초안 작성자 = 토큰의 담당자 (${draft.status} ${mine?.createdBy})`);
  const self = await call('POST', `/admin/v1/deadline-policies/${policyId}/approve`, adminA, {});
  check(self.status >= 400 && self.status !== 401, `작성자 본인 승인은 막힌다 (${self.status})`);
  const adminB = (await staffLogin('admin-b')).tokens?.access_token;
  const ok = await call('POST', `/admin/v1/deadline-policies/${policyId}/approve`, adminB, {});
  check(ok.status === 200, `다른 담당자(방금 로그인)는 승인한다 (${ok.status})`);
  const after = await history();
  check(JSON.stringify(after?.approvedBy) === JSON.stringify(['admin-b']), `승인 기록 = 토큰의 담당자 (${JSON.stringify(after?.approvedBy)})`);
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  api.kill();
}

const result = {
  test: '대학 API oidc 모드 + 실제 로컬 발급자 (T-M5-02·10 단계 3)',
  environment: '축소 환경 — 로컬 Keycloak 26.8.0·CI 재현 DB(:5499)·로컬 admission-api 프로세스',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `api-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 대학 API 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
