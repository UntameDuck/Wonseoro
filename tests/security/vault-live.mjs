// Vault — 대학별 경로 분리·짧은 자격증명 실증 (T-M5-04, docs/13 단계 4)
//
// 사용: 개발 Vault(compose 프로필 vault, :8200)와 CI 재현 DB(:5499 — univ_a, HANDOFF §3)
//       docker compose -f infra/compose/docker-compose.dev.yml --profile vault up -d vault
//       npm run build -w @wonseoro/server-kit -w @wonseoro/admission-api && npm run test:security:vault
//   다른 곳: VAULT_ADDR·VAULT_TOKEN(루트, 구성용), VAULT_LIVE_DB(시험 쪽 관리자 URL), VAULT_DB_URL(Vault 쪽에서 본 DB, {{username}} 자리표시)
// 하는 일
//   1. scripts/vault/dev-vault.mjs 로 구성 — 노션 첨부 정책을 대학마다 그대로(DB 계정 수명은 시험용 20초)
//   2. 정책: UNIV-A 신원으로 UNIV-B 의 KV·DB 자격증명·Transit·PKI 는 403, 남의 대학 SAN URI 발급 거절, 관리 경로 403,
//      같은 대학 안에서도 서류 워커는 Relay 인증서·DB 계정·KEK 를 못 받는다(D-71)
//   3. Transit KEK: 감싸기·풀기, 연결 데이터 다르면 거절, 키 돌리기 뒤 옛 DEK 풀림·rewrap, 최소 버전 올리면 닫힌 실패, UNIV-B 가 UNIV-A 키로 못 풂
//   4. DB 동적 자격증명: 수명 20초 계정을 40초 동안 돌리며 쿼리 — 실패 0, 계정 2개 이상, 교체를 걸친 긴 트랜잭션 성공, 수명 끝난 계정은 지워짐
//   5. PKI: 30초짜리 워크로드 인증서(SAN URI)로 실제 상호 TLS, 다시 받으면 서버·클라이언트가 재기동 없이 새 인증서
//   6. 대학 API 를 Vault 만으로 띄운다(DB 동적 계정·Transit KEK·PKI 인증서) — 준비됨, DB 세션 계정이 Vault 가 만든 계정
// 결과는 tests/security/results/vault-live-<시각>.json
import { spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setupDevVault } from '../../scripts/vault/dev-vault.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kit = await import(new URL('../../packages/server-kit/dist/index.js', import.meta.url).href);
const { VaultClient, VaultError, VaultTransitKeyRing, VaultCertRenewer, vaultDbCredential, Db, FieldKeyUnavailable, InternalHttpClient, EgressPolicy, serverTlsOptions, watchServerTls, peerIdentity } = kit;

const ADDR = process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200';
const ROOT_TOKEN = process.env.VAULT_TOKEN ?? 'dev-root-token';
const ADMIN_DB = process.env.VAULT_LIVE_DB ?? 'postgresql://wonseoro:wonseoro@localhost:5499/univ_a';
const VAULT_DB_URL = process.env.VAULT_DB_URL ?? 'postgresql://{{username}}:{{password}}@host.docker.internal:5499/univ_a?sslmode=disable';
const WORK = path.join(ROOT, '.cache/vault-live');
const LOCAL = new EgressPolicy({ allow: ['localhost', '127.0.0.1'], allowLoopback: true });
const plainFetch = (u, i) => fetch(u, i);

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (p) => p.then(() => 200, (e) => (e instanceof VaultError ? e.status : `${e.name}: ${e.message}`));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const admin = new pg.Client({ connectionString: ADMIN_DB });
let api = null;

try {
  await admin.connect();
  // 다시 돌려도 같은 결과가 나오게 — 지난 실행이 돌린 Transit 키를 지우고 새로 만든다(개발 Vault 는 메모리라 재시작 전까지 남는다)
  for (const key of ['pii-UNIV-A', 'pii-UNIV-B', 'pii-central']) {
    const h = { 'x-vault-token': ROOT_TOKEN, 'content-type': 'application/json' };
    await fetch(`${ADDR}/v1/transit/keys/${key}/config`, { method: 'POST', headers: h, body: JSON.stringify({ deletion_allowed: true }) });
    await fetch(`${ADDR}/v1/transit/keys/${key}`, { method: 'DELETE', headers: h });
  }
  const roles = await setupDevVault({ addr: ADDR, token: ROOT_TOKEN, dbUrl: VAULT_DB_URL, dbTtl: '20s', dbMaxTtl: '2m' });
  check(true, 'Vault 구성 — 첨부 정책을 UNIV-A·UNIV-B 에, 중앙 정책');
  const as = (u, w = 'admission-api') => new VaultClient({ addr: ADDR, auth: { method: 'approle', ...roles[u][w] }, fetch: plainFetch });
  const a = as('UNIV-A');
  const b = as('UNIV-B');
  const docA = as('UNIV-A', 'document-service');
  const relayA = as('UNIV-A', 'event-relay');

  // ── 2. 정책 — 대학 경계 ─────────────────────────────────────────────
  check((await status(a.read('kv/data/universities/UNIV-A/apps/admission'))) === 200, 'UNIV-A 는 자기 KV 를 읽는다');
  const cross = {
    kv: await status(a.read('kv/data/universities/UNIV-B/apps/admission')),
    relayKvOther: await status(a.read('kv/data/universities/UNIV-B/apps/event-relay')),
    dbCreds: await status(a.read('database/creds/admission-api-UNIV-B')),
    transit: await status(a.write('transit/encrypt/pii-UNIV-B', { plaintext: 'AA==' })),
    pki: await status(a.write('pki/issue/kadmission-univ-b-admission-api', { uri_sans: 'spiffe://wonseoro/university/UNIV-B/admission-api' })),
    policies: await status(a.read('sys/policies/acl')),
    centralTransit: await status(a.write('transit/encrypt/pii-central', { plaintext: 'AA==' })),
  };
  check(Object.values(cross).every((s) => s === 403), 'UNIV-A 신원으로 UNIV-B·중앙·관리 경로는 모두 403', cross);
  const spoof = await status(
    a.write('pki/issue/kadmission-univ-a-admission-api', { uri_sans: 'spiffe://wonseoro/university/UNIV-B/admission-api', alt_names: 'localhost' }),
  );
  check(spoof === 400, '자기 PKI 역할로도 다른 대학 SAN URI 인증서는 발급 거절', { status: spoof });
  // 같은 대학 안 — 서류 워커가 Relay 신원을 받으면 중앙에 이벤트를 위조할 수 있다(D-71)
  const workload = {
    docAsRelayRole: await status(docA.write('pki/issue/kadmission-univ-a-event-relay', { uri_sans: 'spiffe://wonseoro/university/UNIV-A/event-relay' })),
    docAsRelayUri: await status(docA.write('pki/issue/kadmission-univ-a-document-service', { uri_sans: 'spiffe://wonseoro/university/UNIV-A/event-relay' })),
    docDbCreds: await status(docA.read('database/creds/admission-api-UNIV-A')),
    docTransit: await status(docA.write('transit/encrypt/pii-UNIV-A', { plaintext: 'AA==' })),
    relayTransit: await status(relayA.write('transit/encrypt/pii-UNIV-A', { plaintext: 'AA==' })),
  };
  check(
    workload.docAsRelayRole === 403 && workload.docAsRelayUri === 400 && workload.docDbCreds === 403 && workload.docTransit === 403 && workload.relayTransit === 403,
    '같은 대학 안에서도 워크로드는 제 신원·제 권한만 — 서류 워커는 Relay 인증서·DB 계정·KEK 를 못 받는다',
    workload,
  );

  // ── 3. Transit KEK ──────────────────────────────────────────────────
  const ringA = new VaultTransitKeyRing(a, 'pii-UNIV-A');
  await ringA.init();
  const dek = Buffer.alloc(32, 7);
  const w1 = await ringA.wrap(dek, 'univ:UNIV-A:application:app-1');
  check(w1.kekId === 'pii-UNIV-A:v1' && w1.wrapped.toString().startsWith('vault:v1:'), 'Transit 로 DEK 감싸기 — KEK 는 Vault 밖으로 나오지 않는다', { kekId: w1.kekId });
  check((await ringA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-1')).equals(dek), '같은 연결 데이터로 풀린다');
  const wrongAad = await ringA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-2').then(() => 'ok', (e) => e.constructor.name);
  check(wrongAad === 'FieldKeyUnavailable', '다른 원서의 연결 데이터로는 풀리지 않는다', { got: wrongAad });
  const ringBonA = new VaultTransitKeyRing(b, 'pii-UNIV-A');
  const bReads = await ringBonA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-1').then(() => 'ok', (e) => e.message);
  check(/403/.test(bReads), 'UNIV-B 신원은 UNIV-A 의 KEK 로 풀지 못한다', { got: bReads.slice(0, 80) });

  const rootVault = new VaultClient({ addr: ADDR, auth: { method: 'token', token: ROOT_TOKEN }, fetch: plainFetch });
  await rootVault.write('transit/keys/pii-UNIV-A/rotate', {});
  const w2 = await ringA.wrap(dek, 'univ:UNIV-A:application:app-3');
  check(w2.kekId === 'pii-UNIV-A:v2' && ringA.activeId === 'pii-UNIV-A:v2', '키를 돌리면 새 DEK 는 새 버전으로 감싼다', { kekId: w2.kekId });
  check((await ringA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-1')).equals(dek), '돌린 뒤에도 옛 버전으로 감싼 DEK 가 풀린다');
  const re = await ringA.wrap(await ringA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-1'), 'univ:UNIV-A:application:app-1');
  await rootVault.write('transit/keys/pii-UNIV-A/config', { min_decryption_version: 2 });
  const oldAfterMin = await ringA.unwrap(w1.kekId, w1.wrapped, 'univ:UNIV-A:application:app-1').then(() => 'ok', (e) => (e instanceof FieldKeyUnavailable ? 'closed' : e.message));
  const reAfterMin = (await ringA.unwrap(re.kekId, re.wrapped, 'univ:UNIV-A:application:app-1')).equals(dek);
  check(oldAfterMin === 'closed' && reAfterMin, 'rewrap 한 DEK 는 최소 버전을 올린 뒤에도 풀리고, 안 한 것은 닫힌 실패', { oldAfterMin, reAfterMin });

  // ── 4. DB 동적 자격증명 ─────────────────────────────────────────────
  process.env.DATABASE_URL = ADMIN_DB.replace(/\/\/[^@]+@/, '//placeholder:placeholder@');
  const db = new Db('admission-api', 'kadmission');
  const first = await db.startCredentialRotation(() => vaultDbCredential(a, 'admission-api-UNIV-A'));
  check(first.leaseSeconds > 0 && first.leaseSeconds <= 20 && first.username.startsWith('v-'), 'Vault 가 수명 20초 DB 계정을 준다', { lease: first.leaseSeconds });
  const role = (
    await db.query(
      `SELECT pg_has_role(current_user, 'kadmission_app', 'MEMBER') AS member,
              (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS elevated`,
    )
  ).rows[0];
  check(role.member === true && role.elevated === false, '동적 계정은 앱 역할(kadmission_app) 권한만 물려받는다 — 슈퍼유저·역할 생성 없음', role);
  const users = new Set();
  let ok = 0;
  let failed = 0;
  const longTx = (async () => {
    // 교체(수명 2/3 = 약 13초) 전에 시작해 옛 계정 수명(20초) 안에 끝나는 트랜잭션 — 교체가 끊지 않는다.
    // 옛 계정 수명이 끝나면 Vault 가 남은 세션을 끊는다 — 트랜잭션이 쓸 수 있는 여유는 수명의 1/3(운영 1시간 → 20분)
    await sleep(8_000);
    return db.tx(async (c) => {
      const u1 = (await c.query('SELECT current_user AS u')).rows[0].u;
      for (let i = 0; i < 4; i++) await c.query('SELECT pg_sleep(2)');
      const u2 = (await c.query('SELECT current_user AS u')).rows[0].u;
      return { u1, u2 };
    });
  })().then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: e.message }));
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    try {
      users.add((await db.query('SELECT current_user AS u')).rows[0].u);
      ok++;
    } catch {
      failed++;
    }
    await sleep(200);
  }
  const tx = await longTx;
  check(failed === 0 && users.size >= 2, '40초 동안 계정이 바뀌어도 쿼리 실패 0', { ok, failed, accounts: users.size });
  check(tx.ok && tx.u1 === tx.u2, '교체를 걸친 트랜잭션은 같은 계정으로 끝까지 간다(옛 계정 수명 안)', tx);
  await sleep(12_000); // 첫 계정 수명(20초) + 정리
  const gone = await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1', [first.username]);
  check(gone.rows[0].n === 0, '수명이 끝난 DB 계정은 Vault 가 지운다', { account: first.username.replace(/[^-]+$/, '…') });
  await db.onApplicationShutdown();

  // ── 4b. DB 비상 접속(T-M5-03) ────────────────────────────────────
  const bg = as('UNIV-A', 'break-glass');
  const bgDenied = { admission: await status(a.read('database/creds/break-glass-UNIV-A')), relay: await status(relayA.read('database/creds/break-glass-UNIV-A')) };
  const bgCred = await vaultDbCredential(bg, 'break-glass-UNIV-A');
  const rec = await admin.query('SELECT db_user, valid_until FROM kadmission.break_glass_access WHERE db_user = $1', [bgCred.username]);
  const setting = await admin.query(
    `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1`,
    [bgCred.username],
  );
  const bgClient = new pg.Client({ connectionString: ADMIN_DB.replace(/\/\/[^@]+@/, `//${encodeURIComponent(bgCred.username)}:${encodeURIComponent(bgCred.password)}@`) });
  await bgClient.connect();
  const bgRead = await bgClient.query('SELECT count(*)::int AS n FROM kadmission.application').then(() => true, () => false);
  const bgDdl = await bgClient.query('CREATE TABLE kadmission.bg_live_ddl (x int)').then(() => true, () => false);
  const bgErase = await bgClient.query('DELETE FROM kadmission.break_glass_access').then(() => true, () => false);
  await bgClient.end();
  check(
    bgDenied.admission === 403 && bgDenied.relay === 403 && bgCred.leaseSeconds <= 900 && rec.rows.length === 1 &&
      JSON.stringify(setting.rows[0]?.setconfig ?? []).includes('log_statement=all') && bgRead && !bgDdl && !bgErase,
    'DB 비상 접속 — 비상 그룹만 15분 계정, 발급이 DB 에 기록·모든 문장 로그, 읽기는 되고 DDL·기록 지우기는 안 된다',
    { denied: bgDenied, lease: bgCred.leaseSeconds, recorded: rec.rows.length, logAll: JSON.stringify(setting.rows[0]?.setconfig ?? []).includes('log_statement=all'), read: bgRead, ddl: bgDdl, erase: bgErase },
  );

  // ── 5. PKI 워크로드 인증서 ──────────────────────────────────────────
  const fileSet = (name) => ({ certFile: path.join(WORK, name, 'tls.crt'), keyFile: path.join(WORK, name, 'tls.key'), caFile: path.join(WORK, name, 'ca.crt') });
  const serverFiles = fileSet('api');
  const clientFiles = fileSet('relay');
  const opts = { ttl: '30s', altNames: ['localhost'], ipSans: ['127.0.0.1'] };
  const srvRenew = new VaultCertRenewer(a, { ...opts, role: 'kadmission-univ-a-admission-api', uri: 'spiffe://wonseoro/university/UNIV-A/admission-api', files: serverFiles });
  const cliRenew = new VaultCertRenewer(relayA, { ...opts, role: 'kadmission-univ-a-event-relay', uri: 'spiffe://wonseoro/university/UNIV-A/event-relay', files: clientFiles });
  const s1 = await srvRenew.issue();
  const c1 = await cliRenew.issue();
  const x = new X509Certificate(readFileSync(clientFiles.certFile));
  check(x.subjectAltName?.includes('URI:spiffe://wonseoro/university/UNIV-A/event-relay') && c1.ttlSeconds <= 24 * 3600, 'Vault 가 SAN URI 워크로드 인증서를 짧게 발급', { ttl: c1.ttlSeconds });
  const server = https.createServer(serverTlsOptions(serverFiles), (req, res) => {
    const peer = peerIdentity(req.socket);
    res.end(JSON.stringify({ uri: peer.identity?.uri ?? null, problem: peer.problem ?? null, serial: req.socket.getPeerCertificate()?.serialNumber ?? null }));
  });
  await new Promise((r) => server.listen(3151, '127.0.0.1', r));
  const stopWatch = watchServerTls(server, serverFiles, 500);
  const client = new InternalHttpClient(clientFiles, LOCAL, 0);
  const call = async () => JSON.parse(await (await client.fetch('https://localhost:3151/internal/x')).text());
  const r1 = await call();
  check(r1.uri === 'spiffe://wonseoro/university/UNIV-A/event-relay', 'Vault 인증서로 실제 상호 TLS — 서버가 SAN URI 신원을 본다', r1);
  await sleep(1_100);
  const c2 = await cliRenew.issue();
  const s2 = await srvRenew.issue();
  await sleep(1_500);
  const r2 = await call();
  const serverSerial = new X509Certificate(readFileSync(serverFiles.certFile)).serialNumber;
  check(
    c2.serial !== c1.serial && s2.serial !== s1.serial && r2.serial?.toLowerCase() === new X509Certificate(readFileSync(clientFiles.certFile)).serialNumber.toLowerCase(),
    '다시 받은 인증서를 서버·클라이언트가 재기동 없이 쓴다',
    { clientRenewed: c2.serial !== c1.serial, serverRenewed: serverSerial.length > 0 },
  );
  stopWatch();
  server.close();

  // ── 6. 대학 API 를 Vault 만으로 ─────────────────────────────────────
  const apiFiles = fileSet('admission-api');
  const env = {
    ...process.env,
    UNIVERSITY_ID: 'UNIV-A',
    PORT: '3141',
    OTEL_METRICS_PORT: '9471',
    DATABASE_URL: ADMIN_DB.replace(/\/\/[^@]+@/, '//placeholder:placeholder@'),
    DATABASE_CREDENTIALS: 'vault',
    VAULT_DB_ROLE: 'admission-api-UNIV-A',
    VAULT_ADDR: ADDR,
    VAULT_ROLE_ID: roles['UNIV-A']['admission-api'].roleId,
    VAULT_SECRET_ID: roles['UNIV-A']['admission-api'].secretId,
    FIELD_KEK_PROVIDER: 'vault',
    VAULT_TRANSIT_KEY: 'pii-UNIV-A',
    INTERNAL_AUTH: 'mtls',
    MTLS_ISSUER: 'vault',
    VAULT_PKI_ROLE: 'kadmission-univ-a-admission-api',
    WORKLOAD_URI: 'spiffe://wonseoro/university/UNIV-A/admission-api',
    VAULT_PKI_ALT_NAMES: 'localhost',
    MTLS_CERT_FILE: apiFiles.certFile,
    MTLS_KEY_FILE: apiFiles.keyFile,
    MTLS_CA_FILE: apiFiles.caFile,
    CLOCK_AUTOSTART: 'false',
    PAYMENT_RECHECK_AUTOSTART: 'false',
    RECON_SCHEDULE_AUTOSTART: 'false',
    IDEMPOTENCY_PURGE_AUTOSTART: 'false',
    S3_AUTO_CREATE_BUCKET: 'false',
  };
  delete env.VAULT_TOKEN;
  const fd = openSync(path.join(WORK, 'admission-api.log'), 'w');
  api = spawn(process.execPath, [path.join(ROOT, 'apps/admission-api/dist/main.js')], { cwd: ROOT, env, stdio: ['ignore', fd, fd] });
  const probe = new InternalHttpClient(clientFiles, LOCAL, 0);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await probe.fetch('https://localhost:3141/readyz').then((r) => r.ok, () => false);
  }
  const sessions = await admin.query(
    `SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = 'univ_a' AND usename LIKE 'v-approle-admissio%'`,
  );
  check(ready && sessions.rows.length >= 1, '대학 API 가 Vault 만으로 뜬다 — DB 동적 계정·Transit KEK 확인·PKI 인증서(HTTPS)', {
    ready,
    vaultDbSessions: sessions.rows.length,
  });
  // 만료 지표(T-M5-65) — 워크로드 인증서·CA·DB 계정의 끝나는 시각을 Prometheus 로 낸다
  const prom = await fetch('http://127.0.0.1:9471/metrics').then((r) => r.text(), () => '');
  const kinds = ['workload-cert', 'ca-cert', 'db-credential'].filter((k) => new RegExp(`credential_expiry_timestamp_seconds\{[^}]*kind="${k}"`).test(prom));
  check(kinds.length === 3, '인증서·CA·DB 계정의 만료 시각을 지표로 낸다(30/14/7/3/1일·갱신 멈춤 경보의 재료)', { kinds });
  const apiCert = new X509Certificate(readFileSync(apiFiles.certFile));
  check(apiCert.subjectAltName?.includes('URI:spiffe://wonseoro/university/UNIV-A/admission-api'), '대학 API 의 인증서는 기동 때 Vault 에서 받은 것');
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  if (api) api.kill();
  await admin.end().catch(() => undefined);
}

const result = {
  test: 'Vault — 대학별 경로 분리·짧은 자격증명 (T-M5-04)',
  environment: '축소 환경 — 개발 모드 Vault 1.21(메모리), CI 재현 DB, 노션 첨부 정책 그대로',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/security/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `vault-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} Vault 실증 ${steps.length}개 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exit(result.passed ? 0 : 1);
