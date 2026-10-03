// 발급자 단절 중 접수 지속 — JWKS 캐시·단절 유예 실증 (T-M3-06, T-M5-02 단계 7, D-67)
//
// 사용: 로컬 발급자(--profile auth, 컨테이너 wonseoro-dev-keycloak-1)와 CI 재현 DB(:5499, HANDOFF §3)가 떠 있을 때
//       npm run build -w @wonseoro/contracts -w @wonseoro/server-kit -w @wonseoro/admission-api && npm run test:auth:offline
// 걸리는 시간 약 9분 — 액세스 토큰(5분)이 실제로 끝나기를 기다린다.
//
// 무엇을 보이나 (2시간 단절을 축소해서)
//   1. 발급자를 멈춘 채, 멈추기 전에 로그인한 지원자가 원서 생성·저장·결제 확인·제출(자동 접수)까지 한다 — 키 캐시
//   2. 발급자가 멈춘 동안 API 를 다시 띄워도 이어진다 — 디스크에 남긴 공개키(스냅숏)
//   3. 액세스 토큰이 끝난 뒤에도(갱신할 발급자가 없다) 다른 지원자가 처음부터 접수까지 한다 — 단절 유예
//   4. 유예는 끝이 있다(짧은 유예로 띄운 API 는 거절), 담당자 토큰에는 유예가 없다
//   5. 발급자가 돌아오면 만료 토큰은 다시 거절되고, 갱신 토큰으로 새 토큰을 받아 이어 간다
// 시험 지원자는 매번 새로 만들고(관리 API, 로컬 전용 비밀번호는 매번 새로 만든다) 끝나면 지운다 — 다시 돌려도 같은 결과.
// 결과는 tests/auth/results/offline-live-<시각>.json
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE, browserLogin, claims } from './helpers/login.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KC = process.env.AUTH_ISSUER_CONTAINER ?? 'wonseoro-dev-keycloak-1';
const DB = process.env.AUTH_API_DB ?? 'postgresql://kadmission_app:kadmission_app_dev@localhost:5499/univ_a';
const REALM = 'wonseoro-applicant';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: '발급자 단절 시험 고등학교', graduationYear: 2026, selfIntro: '발급자가 멈춘 동안 이어서 접수하는 시험입니다.' };
const SNAPSHOT_DIR = path.join(ROOT, '.cache/auth/offline-jwks');

const started = Date.now();
const steps = [];
const problems = [];
const timeline = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};
const mark = (event) => {
  timeline.push({ at: new Date().toISOString(), sinceStartSec: Math.round((Date.now() - started) / 1000), event });
  console.log(`· ${event}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 발급자 ─────────────────────────────────────────────────────────── */

const issuerUp = () => fetch(`${ISSUER_BASE}/realms/${REALM}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
async function waitIssuer(up, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await issuerUp()) === up) return true;
    await sleep(1000);
  }
  return false;
}

// 로컬 발급자 관리자 — compose 파일의 개발용 값을 그대로 읽는다(값을 여기 다시 적지 않는다)
const compose = readFileSync(path.join(ROOT, 'infra/compose/docker-compose.dev.yml'), 'utf8');
const kcAdmin = { username: compose.match(/KC_BOOTSTRAP_ADMIN_USERNAME:\s*(\S+)/)?.[1], password: compose.match(/KC_BOOTSTRAP_ADMIN_PASSWORD:\s*(\S+)/)?.[1] };
async function adminToken() {
  const res = await fetch(`${ISSUER_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', ...kcAdmin }),
  });
  if (!res.ok) throw new Error(`발급자 관리 토큰 ${res.status}`);
  return (await res.json()).access_token;
}
async function createApplicant(label) {
  const username = `offline-${label}-${randomUUID().slice(0, 8)}`;
  const password = randomBytes(18).toString('base64url');
  const res = await fetch(`${ISSUER_BASE}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username, enabled: true, email: `${username}@example.test`, emailVerified: true, firstName: '시험', lastName: '단절',
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  if (res.status !== 201) throw new Error(`시험 지원자 생성 ${res.status}`);
  return { username, password, id: res.headers.get('location')?.split('/').pop() };
}
async function deleteApplicant(u) {
  if (!u?.id) return;
  await fetch(`${ISSUER_BASE}/admin/realms/${REALM}/users/${u.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${await adminToken()}` } }).catch(() => {});
}
const login = (u) => browserLogin({ realm: REALM, clientId: 'applicant-web', redirectUri: 'http://localhost:4001/auth/callback', username: u.username, password: u.password });

const staffRealm = JSON.parse(readFileSync(path.join(ROOT, 'infra/auth/wonseoro-staff.realm.json'), 'utf8'));
async function staffLogin(username) {
  const u = staffRealm.users.find((x) => x.username === username);
  return browserLogin({
    realm: 'wonseoro-staff', clientId: 'admin-web', clientSecret: staffRealm.clients.find((c) => c.clientId === 'admin-web').secret,
    redirectUri: 'http://localhost:4100/auth/callback', username,
    password: u.credentials.find((c) => c.type === 'password').value,
    otpSecret: JSON.parse(u.credentials.find((c) => c.type === 'otp').secretData).value,
  });
}

/* ── 대학 API ───────────────────────────────────────────────────────── */

const apis = new Set();
function startApi({ port, metricsPort, graceMs }) {
  const env = {
    ...process.env,
    PORT: String(port),
    UNIVERSITY_ID: 'UNIV-A',
    DATABASE_URL: DB,
    AUTH_MODE: 'oidc',
    OIDC_APPLICANT_ISSUER: `${ISSUER_BASE}/realms/${REALM}`,
    OIDC_STAFF_ISSUER: `${ISSUER_BASE}/realms/wonseoro-staff`,
    OIDC_JWKS_SNAPSHOT_DIR: SNAPSHOT_DIR,
    OTEL_METRICS_PORT: String(metricsPort),
    CLOCK_AUTOSTART: 'false',
    PAYMENT_RECHECK_AUTOSTART: 'false',
    RECON_SCHEDULE_AUTOSTART: 'false',
    IDEMPOTENCY_PURGE_AUTOSTART: 'false',
    CENTRAL_GATE_AUTOSTART: 'false',
    S3_AUTO_CREATE_BUCKET: 'false',
    THROTTLE_MODE: 'off',
  };
  if (graceMs !== undefined) env.OIDC_APPLICANT_OUTAGE_GRACE_MS = String(graceMs);
  else delete env.OIDC_APPLICANT_OUTAGE_GRACE_MS; // 기본값(2시간)으로 뜬다
  const child = spawn(process.execPath, [path.join(ROOT, 'apps/admission-api/dist/main.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const api = { base: `http://localhost:${port}`, metrics: `http://localhost:${metricsPort}/metrics`, child, log: '' };
  child.stdout.on('data', (d) => (api.log += d));
  child.stderr.on('data', (d) => (api.log += d));
  apis.add(api);
  return api;
}
async function ready(api) {
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await fetch(`${api.base}/api/v1/meta/time`).then((r) => r.ok, () => false)) return;
  }
  throw new Error(`API 가 뜨지 않았다\n${api.log.slice(-2000)}`);
}
async function stopApi(api) {
  api.child.kill();
  await new Promise((r) => (api.child.exitCode !== null ? r() : api.child.once('exit', r)));
  apis.delete(api);
}

async function call(api, method, url, token, { body, headers = {} } = {}) {
  const res = await fetch(`${api.base}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': `offline-${randomUUID()}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, json, etag: res.headers.get('etag') };
}

/** 원서 생성 → 저장 → 결제 → 결제 확인(자동 접수) → 접수 확인 */
async function applyFlow(api, token) {
  const t0 = Date.now();
  const out = { steps: {} };
  const made = await call(api, 'POST', '/api/v1/applications', token, { body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT } });
  out.steps.create = made.status;
  if (made.status !== 201) return out;
  const id = made.json.id;
  const saved = await call(api, 'PATCH', `/api/v1/applications/${id}`, token, {
    body: { fields: FIELDS },
    headers: { 'content-type': 'application/merge-patch+json', 'if-match': made.etag },
  });
  out.steps.save = saved.status;
  const intent = await call(api, 'POST', `/api/v1/applications/${id}/payment-intents`, token);
  out.steps.paymentIntent = intent.status;
  const verified = await call(api, 'POST', `/api/v1/payments/${intent.json.paymentId}/verify`, token);
  out.steps.paymentVerify = verified.status;
  const sub = await call(api, 'GET', `/api/v1/applications/${id}/submission`, token);
  out.steps.submission = sub.status;
  out.applicationId = id;
  out.applicationNumber = sub.json.applicationNumber ?? null;
  out.ms = Date.now() - t0;
  out.ok = made.status === 201 && saved.status === 200 && intent.status === 201 && verified.status === 200 && sub.status === 200 && !!out.applicationNumber;
  return out;
}

async function graceCount(api) {
  const text = await fetch(api.metrics).then((r) => r.text(), () => '');
  return text
    .split('\n')
    .filter((l) => l.startsWith('auth_decisions') && l.includes('result="grace"'))
    .reduce((n, l) => n + Number(l.trim().split(/\s+/).pop()), 0);
}

/* ── 시나리오 ───────────────────────────────────────────────────────── */

const users = [];
let issuerStopped = false;
try {
  if (!(await issuerUp())) throw new Error(`로컬 발급자가 떠 있지 않다 (${ISSUER_BASE}) — docker compose -f infra/compose/docker-compose.dev.yml --profile auth up -d keycloak`);
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });

  const a = await createApplicant('a');
  const b = await createApplicant('b');
  users.push(a, b);
  const la = await login(a);
  const lb = await login(b);
  const ls = await staffLogin('admin-a');
  if (!la.tokens || !lb.tokens || !ls.tokens) throw new Error(`로그인 실패 ${la.error ?? ''} ${lb.error ?? ''} ${ls.error ?? ''}`);
  const ta = la.tokens.access_token;
  const tb = lb.tokens.access_token;
  const tStaff = ls.tokens.access_token;
  const expB = claims(tb).exp * 1000;
  const expStaff = claims(tStaff).exp * 1000;
  mark(`지원자 둘·담당자 로그인 — 지원자 B 토큰 만료 ${new Date(expB).toISOString()}`);

  let api = startApi({ port: 3111, metricsPort: 9481 });
  await ready(api);
  const probe = `/api/v1/applications/${randomUUID()}`;
  check((await call(api, 'GET', probe, ta)).status === 404 && (await call(api, 'GET', probe, tb)).status === 404, '단절 전 — 두 지원자 토큰이 통과한다(남의 원서는 404)');
  check((await call(api, 'GET', `/admin/v1/config/active?cycleId=${CYCLE}`, tStaff)).status === 200, '단절 전 — 담당자 토큰이 통과한다');

  // 1. 발급자 정지
  execFileSync('docker', ['stop', KC], { stdio: 'ignore' });
  issuerStopped = true;
  check(await waitIssuer(false, 30_000), '발급자 컨테이너를 멈췄다 — discovery 가 닿지 않는다');
  mark('발급자 정지');

  const flowA = await applyFlow(api, ta);
  check(flowA.ok, '발급자 정지 중 — 지원자 A 가 원서 생성·저장·결제 확인·접수까지 한다(유효한 토큰, 키 캐시)', flowA);

  // 2. 발급자가 멈춘 동안 API 재기동 — 디스크의 공개키로 시작
  await stopApi(api);
  api = startApi({ port: 3111, metricsPort: 9481 });
  await ready(api);
  const afterRestart = await call(api, 'GET', `/api/v1/applications/${flowA.applicationId}/submission`, ta);
  check(afterRestart.status === 200 && afterRestart.json.applicationNumber === flowA.applicationNumber, '발급자 정지 중 API 재기동 — 스냅숏의 공개키로 지원자 A 의 접수증이 열린다', { status: afterRestart.status });
  mark('발급자 정지 중 API 재기동');

  // 3. 액세스 토큰이 끝나기를 기다린다 — 시계 오차 허용(30초)과 짧은 유예(60초)를 넘길 만큼
  const waitUntil = Math.max(expB, expStaff) + 75_000;
  mark(`토큰 만료 대기 ${Math.round((waitUntil - Date.now()) / 1000)}초`);
  while (Date.now() < waitUntil) {
    await sleep(Math.min(30_000, waitUntil - Date.now()));
    // 대기 중에도 화면은 계속 저장한다 — 지원자 A 로 주기적으로 읽어 API 가 살아 있는지 본다
    await call(api, 'GET', `/api/v1/applications/${flowA.applicationId}`, ta);
  }
  check(Date.now() > expB + 60_000, '지원자 B 의 액세스 토큰이 끝난 지 1분이 넘었다', { expiredForSec: Math.round((Date.now() - expB) / 1000) });
  const graceBefore = await graceCount(api);
  const flowB = await applyFlow(api, tb);
  check(flowB.ok, '만료 토큰(갱신할 발급자 없음)으로 지원자 B 가 처음부터 접수까지 한다 — 단절 유예', flowB);
  const graced = (await graceCount(api)) - graceBefore;
  check(graced >= 5, '단절 유예로 받은 요청이 지표(auth_decisions result=grace)에 남는다', { graced });
  check(/단절 유예로 받는 중/.test(api.log), '단절 유예를 쓰는 동안 경고 로그를 남긴다(1분에 한 줄)');
  const staffExpired = await call(api, 'GET', `/admin/v1/config/active?cycleId=${CYCLE}`, tStaff);
  check(staffExpired.status === 401, '담당자 토큰에는 유예가 없다 — 만료되면 401', { status: staffExpired.status });
  mark('단절 유예로 접수');

  // 4. 유예는 끝이 있다 — 60초 유예로 띄운 API 는 만료된 지 1분이 넘은 토큰을 받지 않는다
  const short = startApi({ port: 3113, metricsPort: 9482, graceMs: 60_000 });
  await ready(short);
  const beyond = await call(short, 'GET', `/api/v1/applications/${flowB.applicationId}/submission`, tb);
  check(beyond.status === 401 && beyond.json.code === 'UNAUTHENTICATED', '유예(축소 60초)를 넘긴 만료 토큰은 거절한다', { status: beyond.status });
  const stillOk = await call(short, 'GET', `/api/v1/applications/${flowA.applicationId}/submission`, ta);
  check(stillOk.status === 401, '같은 API 에서 지원자 A 의 토큰도 유예를 넘겼다 — 끝없이 받지 않는다', { status: stillOk.status });
  await stopApi(short);

  // 5. 발급자 복구
  execFileSync('docker', ['start', KC], { stdio: 'ignore' });
  const backAt = Date.now();
  check(await waitIssuer(true, 180_000), '발급자 컨테이너를 다시 띄웠다');
  issuerStopped = false;
  mark(`발급자 복구 (${Math.round((Date.now() - backAt) / 1000)}초)`);
  // 직전의 "닿지 않음" 판단은 쿨다운(30초) 동안 그대로다 — 그 뒤 만료 토큰은 다시 거절된다
  let rejectedAgain = null;
  for (let i = 0; i < 20 && rejectedAgain === null; i++) {
    const r = await call(api, 'GET', `/api/v1/applications/${flowB.applicationId}/submission`, tb);
    if (r.status === 401) rejectedAgain = Date.now() - backAt;
    else await sleep(5000);
  }
  check(rejectedAgain !== null, '발급자가 돌아오면 만료 토큰은 다시 401 — 갱신하라는 뜻', { afterSec: rejectedAgain === null ? null : Math.round(rejectedAgain / 1000) });
  const refreshed = await fetch(`${ISSUER_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: lb.tokens.refresh_token, client_id: 'applicant-web' }),
  });
  const fresh = refreshed.ok ? (await refreshed.json()).access_token : null;
  const resumed = fresh ? await call(api, 'GET', `/api/v1/applications/${flowB.applicationId}/submission`, fresh) : { status: refreshed.status };
  check(resumed.status === 200, '갱신 토큰으로 새 토큰을 받아 이어 간다 — 다시 로그인하지 않는다', { status: resumed.status });
  mark('복구 뒤 갱신');
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  for (const api of [...apis]) await stopApi(api);
  if (issuerStopped) {
    execFileSync('docker', ['start', KC], { stdio: 'ignore' });
    await waitIssuer(true, 180_000);
  }
  for (const u of users) await deleteApplicant(u);
}

const result = {
  test: '발급자 단절 중 접수 지속 — JWKS 캐시·스냅숏·단절 유예 (T-M3-06, T-M5-02 단계 7, D-67)',
  environment: '축소 환경 — 로컬 Keycloak 26.8.0(컨테이너 정지·재기동)·CI 재현 DB(:5499)·로컬 admission-api 프로세스. 2시간 단절 대신 액세스 토큰 1회 만료(약 6분)로 보인다',
  at: new Date(started).toISOString(),
  durationSec: Math.round((Date.now() - started) / 1000),
  passed: problems.length === 0,
  timeline,
  steps,
};
const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `offline-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 발급자 단절 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
