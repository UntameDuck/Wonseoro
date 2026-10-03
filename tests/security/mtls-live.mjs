// 서비스 간 상호 TLS·대학 신원 묶기 — 실제 TLS 로 끝에서 끝까지 (T-M5-05·09, docs/13 단계 1, D-69)
//
// 사용: CI 재현 DB(:5499 — univ_a·central, HANDOFF §3)가 있을 때(다른 DB 는 MTLS_LIVE_DB=<서버 주소>·MTLS_LIVE_UNIV_DB=<대학 DB 앱 계정 주소>)
//       npm run build -w @wonseoro/server-kit -w @wonseoro/central-api -w @wonseoro/admission-api -w @wonseoro/event-relay && npm run test:security:mtls
// 하는 일
//   1. 개발 PKI(scripts/pki/dev-pki.mjs — 1시간짜리)를 .cache/pki-mtls-live 에 만든다
//   2. 중앙 API(:3132)·대학 API(:3131)를 INTERNAL_AUTH=mtls 로, 실제 Relay 를 UNIV-A 인증서로 띄운다(심장박동 5초)
//   3. 워크로드 인증서를 바꿔 가며 내부 경로 여섯을 부른다 — 인증서 없음·다른 CA·다른 워크로드·다른 대학은 거절, 제 것은 통과
//   4. 실제 Relay 의 심장박동이 상호 TLS 로 중앙에 닿았는지 본다
// 결과는 tests/security/results/mtls-live-<시각>.json
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDevPki } from '../../scripts/pki/dev-pki.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { InternalHttpClient } = await import(new URL('../../packages/server-kit/dist/index.js', import.meta.url).href);
const DB = process.env.MTLS_LIVE_DB ?? 'postgresql://wonseoro:wonseoro@localhost:5499';
const UNIV_DB = process.env.MTLS_LIVE_UNIV_DB ?? 'postgresql://kadmission_app:kadmission_app_dev@localhost:5499/univ_a';
const PKI = path.join(ROOT, '.cache/pki-mtls-live');
const LOGS = path.join(ROOT, '.cache/mtls-live');
const CENTRAL = 'https://localhost:3132';
const API = 'https://localhost:3131';

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(PKI, { recursive: true, force: true });
mkdirSync(LOGS, { recursive: true });
const pki = createDevPki({ out: PKI, hours: 1 });
const files = (name) => ({ certFile: pki[name].cert, keyFile: pki[name].key, caFile: pki.ca });
const as = (name) => new InternalHttpClient(files(name));

const procs = [];
function start(name, app, env) {
  const fd = openSync(path.join(LOGS, `${name}.log`), 'w');
  const p = spawn(process.execPath, [path.join(ROOT, `apps/${app}/dist/main.js`)], {
    cwd: ROOT,
    env: { ...process.env, CLOCK_AUTOSTART: 'false', PAYMENT_RECHECK_AUTOSTART: 'false', RECON_SCHEDULE_AUTOSTART: 'false', IDEMPOTENCY_PURGE_AUTOSTART: 'false', S3_AUTO_CREATE_BUCKET: 'false', ...env },
    stdio: ['ignore', fd, fd],
  });
  procs.push(p);
  return p;
}
async function up(url, client) {
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await client.fetch(`${url}/readyz`).then((r) => r.ok, () => false)) return true;
  }
  return false;
}

/** 내부 경로 호출 — 상태 코드(연결 실패면 0) */
async function call(client, method, url, body, contentType = 'application/json') {
  try {
    const res = await client.fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': contentType, 'idempotency-key': `mtls-${randomUUID()}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      /* 본문 없음 */
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, error: String(err.cause?.code ?? err.message) };
  }
}

const heartbeat = (universityId) => ({
  specversion: '1.0',
  id: randomUUID(),
  source: `urn:k-admission:university:${universityId}`,
  type: 'kr.kadmission.sync.heartbeat.v1',
  subject: `university:${universityId}`,
  time: new Date().toISOString(),
  datacontenttype: 'application/json',
  kadmissionuniversity: universityId,
  kadmissionsequence: Math.floor(Date.now() / 1000),
  data: { universityId, platformVersion: 'mtls-live', configVersion: 'mtls-live', pendingOutbox: 0, oldestPendingAgeSeconds: 0 },
});

try {
  const db = new pg.Client({ connectionString: `${DB}/central` });
  await db.connect();
  await db.query(`INSERT INTO kadmission_central.university_registry (id, name, status) VALUES ('UNIV-A','원서로대학교','ACTIVE'), ('UNIV-B','다른대학교','ACTIVE') ON CONFLICT (id) DO NOTHING`);
  await db.end();

  const mtls = (name) => ({ INTERNAL_AUTH: 'mtls', MTLS_CERT_FILE: pki[name].cert, MTLS_KEY_FILE: pki[name].key, MTLS_CA_FILE: pki.ca });
  start('central-api', 'central-api', { PORT: '3132', DATABASE_URL: `${DB}/central`, OTEL_METRICS_PORT: '9493', ...mtls('central-api') });
  start('admission-api', 'admission-api', {
    PORT: '3131', UNIVERSITY_ID: 'UNIV-A', DATABASE_URL: UNIV_DB,
    CENTRAL_SYNC_URL: CENTRAL, CENTRAL_GATE_AUTOSTART: 'false', OTEL_METRICS_PORT: '9494', ...mtls('univ-a-admission-api'),
  });
  const reader = as('univ-a-event-relay');
  check(await up(CENTRAL, reader), '중앙 API 가 HTTPS 로 떴다(상호 TLS 모드)');
  check(await up(API, reader), '대학 API 가 HTTPS 로 떴다(상호 TLS 모드)');

  // 평문·공개 경로
  const plain = await fetch('http://localhost:3132/readyz').then((r) => r.status, () => 0);
  check(plain !== 200, '평문 HTTP 로는 중앙에 닿지 않는다', { status: plain });
  check((await call(new InternalHttpClient({ ...files('univ-a-event-relay') }), 'GET', `${CENTRAL}/readyz`)).status === 200, '공개 경로(/readyz)는 인증서와 상관없이 열린다');

  // 중앙 — 이벤트 수신
  const ev = `${CENTRAL}/internal/v1/events`;
  const ce = 'application/cloudevents+json';
  // 인증서 없이: 서버 인증서는 믿도록 CA 만 주는 클라이언트를 따로 만든다
  const { Agent, fetch: uf } = await import('undici');
  const caOnly = new Agent({ connect: { ca: readFileSync(pki.ca) } });
  const bare = await uf(ev, { method: 'POST', dispatcher: caOnly, headers: { 'content-type': ce }, body: JSON.stringify(heartbeat('UNIV-A')) });
  check(bare.status === 401, '인증서 없이 이벤트를 보내면 401', { status: bare.status });
  const rogue = await call(new InternalHttpClient({ certFile: pki['rogue-univ-a-relay'].cert, keyFile: pki['rogue-univ-a-relay'].key, caFile: pki.ca }), 'POST', ev, heartbeat('UNIV-A'), ce);
  check(rogue.status === 401 || rogue.status === 0, '플랫폼 CA 가 아닌 곳이 서명한 같은 이름의 인증서는 거절(401)', { status: rogue.status });
  const spoof = await call(as('univ-b-event-relay'), 'POST', ev, heartbeat('UNIV-A'), ce);
  check(spoof.status === 403, 'UNIV-B Relay 가 UNIV-A 이름으로 보낸 이벤트는 403 — 다른 대학 사칭', { status: spoof.status });
  const wrongWorkload = await call(as('univ-a-admission-api'), 'POST', ev, heartbeat('UNIV-A'), ce);
  check(wrongWorkload.status === 403, '같은 대학이라도 Relay 가 아닌 워크로드(대학 API)는 이벤트를 보낼 수 없다(403)', { status: wrongWorkload.status });
  const own = heartbeat('UNIV-A');
  const ok = await call(as('univ-a-event-relay'), 'POST', ev, own, ce);
  check(ok.status === 202, 'UNIV-A Relay 가 자기 대학 이벤트를 보내면 202', { status: ok.status, json: ok.status === 202 ? undefined : ok.json });
  const bOwn = await call(as('univ-b-event-relay'), 'POST', ev, heartbeat('UNIV-B'), ce);
  check(bOwn.status === 202, 'UNIV-B Relay 는 자기 대학 이벤트를 보낸다(202)', { status: bOwn.status });

  // 중앙 — 영수증(심장박동은 원장에 남지 않는다 — 원장에 남는 접수 취소 이벤트로 본다)
  const cancelled = {
    ...heartbeat('UNIV-A'),
    type: 'kr.kadmission.application.cancelled.v1',
    subject: `application:${randomUUID()}`,
    kadmissionsequence: 1,
    data: { applicationId: randomUUID(), applicationNumber: null, cancelledAt: new Date().toISOString() },
  };
  const posted = await call(as('univ-a-event-relay'), 'POST', ev, cancelled, ce);
  check(posted.status === 202, 'UNIV-A Relay 의 접수 취소 이벤트(원장에 남는다) 202', { status: posted.status, json: posted.status === 202 ? undefined : posted.json });
  const rc = `${CENTRAL}/internal/v1/events/${cancelled.id}/receipt`;
  check((await call(as('univ-a-event-relay'), 'GET', rc)).status === 200, '자기 대학 이벤트의 영수증은 열린다');
  check((await call(as('univ-b-event-relay'), 'GET', rc)).status === 404, '다른 대학 이벤트의 영수증은 없는 것처럼(404)');

  // 중앙 — 공통원서 스냅숏
  const snap = (universityId) => ({ subjectToken: `mtls-${randomUUID()}`, universityId, requestedFields: ['highSchool'], applicationRef: randomUUID() });
  const snapB = await call(as('univ-b-admission-api'), 'POST', `${CENTRAL}/internal/v1/profile-snapshots`, snap('UNIV-A'));
  check(snapB.status === 403, 'UNIV-B 대학 API 가 UNIV-A 에 동의된 공통원서를 요청하면 403', { status: snapB.status });
  const snapA = await call(as('univ-a-admission-api'), 'POST', `${CENTRAL}/internal/v1/profile-snapshots`, snap('UNIV-A'));
  check(snapA.status === 200, 'UNIV-A 대학 API 는 자기 대학 스냅숏을 받는다(200 — 동의가 없으면 빈 스냅숏)', { status: snapA.status });
  const snapRelay = await call(as('univ-a-event-relay'), 'POST', `${CENTRAL}/internal/v1/profile-snapshots`, snap('UNIV-A'));
  check(snapRelay.status === 403, 'Relay 인증서로는 공통원서를 받을 수 없다(403)', { status: snapRelay.status });

  // 중앙 — 관제
  check((await call(as('univ-a-event-relay'), 'GET', `${CENTRAL}/internal/v1/sync/status`)).status === 403, '대학 워크로드는 중앙 관제 경로를 못 본다(403)');
  check((await call(as('central-api'), 'GET', `${CENTRAL}/internal/v1/sync/status`)).status === 200, '중앙 워크로드는 관제 경로를 본다');

  // 대학 API — 서류 검사 경로
  const pending = `${API}/internal/v1/documents/pending-scan?limit=5`;
  const bareApi = await uf(pending, { dispatcher: caOnly });
  check(bareApi.status === 401, '인증서 없이 서류 검사 대기 목록을 읽으면 401 — 지원자 서류 내려받기 주소가 들어 있다', { status: bareApi.status });
  check((await call(as('univ-a-event-relay'), 'GET', pending)).status === 403, '같은 대학의 다른 워크로드(Relay)는 403');
  check((await call(as('univ-b-admission-api'), 'GET', pending)).status === 403, '다른 대학 워크로드는 403');
  check((await call(as('univ-a-document-service'), 'GET', pending)).status === 200, '같은 대학 서류 워커는 읽는다');
  const forged = await call(as('univ-b-admission-api'), 'POST', `${API}/internal/v1/documents/${randomUUID()}/scan-result`, { result: 'CLEAN', scanner: 'x', engineVersion: '1' });
  check(forged.status === 403, '다른 대학 워크로드는 검사 결과를 보낼 수 없다(403 — 악성 파일을 깨끗함으로)', { status: forged.status });
  await caOnly.close();

  // 실제 Relay 가 상호 TLS 로 중앙에 심장박동을 보낸다
  start('event-relay', 'event-relay', {
    UNIVERSITY_ID: 'UNIV-A', DATABASE_URL: UNIV_DB, CENTRAL_SYNC_URL: CENTRAL,
    RELAY_HEARTBEAT_INTERVAL_MS: '5000', PORT: '3133', OTEL_METRICS_PORT: '9495', ...mtls('univ-a-event-relay'),
  });
  let seen = null;
  for (let i = 0; i < 30 && !seen; i++) {
    await sleep(1000);
    const s = await call(as('central-api'), 'GET', `${CENTRAL}/internal/v1/sync/status`);
    const a = (s.json.universities ?? s.json.items ?? []).find?.((u) => u.universityId === 'UNIV-A');
    if (a?.lastHeartbeatAt && Date.parse(a.lastHeartbeatAt) > started) seen = a.lastHeartbeatAt;
  }
  check(seen, '실제 Relay(UNIV-A 인증서)의 심장박동이 상호 TLS 로 중앙에 닿았다', { lastHeartbeatAt: seen });
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  for (const p of procs) p.kill();
}

const result = {
  test: '서비스 간 상호 TLS·대학 신원 묶기 (T-M5-05·09, D-69)',
  environment: '축소 환경 — 로컬 프로세스·CI 재현 DB(:5499)·개발 PKI(openssl, 1시간 인증서)',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/security/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `mtls-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 상호 TLS 실증 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exitCode = result.passed ? 0 : 1;
