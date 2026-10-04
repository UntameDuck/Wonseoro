// 토큰을 붙인 ZAP DAST 를 이 PC 에서 CI 와 같은 순서로 돌린다 (T-M5-27, T-M5-02 단계 9)
//
// 사용: node scripts/security/dast-local.mjs [--out=E:/DockerData/tools/zap-2.17.0/reports-auth]
//   1. 빈 PostgreSQL 컨테이너(dast-pg :5498, --rm)에 스키마·개발 시드·CI 마감 시드
//   2. 시험 발급자(dast-issuer.mjs :18099)와 대학 API(AUTH_MODE=oidc :3121, 지표 :9491)
//   3. ZAP 2.17.0(고정 digest) OpenAPI active scan — 지원자 경로엔 지원자 토큰, 운영 경로엔 담당자 토큰(zap-auth-hook.py)
//   4. High 0(check-zap-report.mjs) · 인증 뒤까지 닿았나(check-dast-auth.mjs)
//   끝나면 컨테이너·프로세스를 내린다(dast-pg 는 --rm 이라 함께 사라진다). 보고서는 --out 폴더(저장소 밖 E 드라이브)
// CI 는 .github/workflows/security.yml 의 dast 잡이 같은 일을 한다 — 둘을 함께 고친다.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.resolve(process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'E:/DockerData/tools/zap-2.17.0/reports-auth');
const ZAP = 'ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef';
const PG = 'dast-pg';
const API_PORT = 3121;
const METRICS = 9491;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

function psql(file, db = 'univ_a') {
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-q', '-U', 'wonseoro', '-d', db, '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(path.join(ROOT, file)),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}
/** 로그는 파일로 받는다 — 파이프로 받으면 ZAP 을 기다리는 동안 아무도 비우지 않아 서버가 로그 쓰기에서 멈춘다 */
function start(name, args, env = {}) {
  const logFile = path.join(OUT, `${name}.log`);
  const fd = openSync(logFile, 'w');
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
  p.logFile = logFile;
  procs.push(p);
  return p;
}
const tail = (p) => readFileSync(p.logFile, 'utf8').slice(-1500);
/** 끝날 때까지 기다리되 이벤트 루프를 막지 않는다 */
const run = (cmd, args) => new Promise((resolve) => spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' }).on('exit', (c) => resolve(c)));

let code = 1;
try {
  mkdirSync(OUT, { recursive: true });
  spawnSync('docker', ['rm', '-f', PG], { stdio: 'ignore' });
  execFileSync('docker', ['run', '-d', '--rm', '--name', PG, '-e', 'POSTGRES_USER=wonseoro', '-e', 'POSTGRES_PASSWORD=wonseoro', '-e', 'POSTGRES_DB=univ_a', '-p', '5498:5432', 'postgres:16-alpine'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && spawnSync('docker', ['exec', PG, 'pg_isready', '-U', 'wonseoro', '-d', 'univ_a']).status !== 0; i++) await sleep(1000);
  await sleep(2000);
  for (const f of ['migrations/0001_init.sql', 'migrations/0002_db_roles.sql', 'migrations/0003_field_encryption.sql', 'migrations/0004_break_glass.sql', 'migrations/0005_outbox_archive.sql', 'migrations/0006_writer_fence.sql', 'migrations/0007_service_incident.sql', 'migrations/0008_support_view.sql', 'migrations/0009_privacy_request.sql', 'dev-roles.sql', 'seed-dev.sql', 'ci-seed-deadline.sql']) psql(`infra/db/${f}`);
  console.log('✔ DB 준비 (dast-pg :5498)');

  const tokens = path.join(OUT, 'tokens');
  const issuer = start('dast-issuer', ['scripts/security/dast-issuer.mjs', '--port=18099', `--out=${tokens}`]);
  const api = start('admission-api', ['apps/admission-api/dist/main.js'], {
    PORT: String(API_PORT),
    UNIVERSITY_ID: 'UNIV-A',
    DATABASE_URL: 'postgresql://kadmission_app:kadmission_app_dev@localhost:5498/univ_a',
    AUTH_MODE: 'oidc',
    OIDC_APPLICANT_ISSUER: 'http://127.0.0.1:18099/realms/applicant',
    OIDC_STAFF_ISSUER: 'http://127.0.0.1:18099/realms/staff',
    OTEL_METRICS_PORT: String(METRICS),
    THROTTLE_MODE: 'off',
    CENTRAL_GATE_AUTOSTART: 'false',
    CLOCK_AUTOSTART: 'false',
    PAYMENT_RECHECK_AUTOSTART: 'false',
    RECON_SCHEDULE_AUTOSTART: 'false',
    IDEMPOTENCY_PURGE_AUTOSTART: 'false',
    S3_AUTO_CREATE_BUCKET: 'false',
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(500);
    up = await fetch(`http://127.0.0.1:${API_PORT}/readyz`).then((r) => r.ok, () => false);
  }
  if (!up) throw new Error(`API 가 뜨지 않았다\n${tail(api)}\n${tail(issuer)}`);
  console.log('✔ 시험 발급자·대학 API(oidc) 기동');

  const applicant = readFileSync(path.join(tokens, 'applicant.token'), 'utf8').trim();
  const staff = readFileSync(path.join(tokens, 'staff.token'), 'utf8').trim();
  const zap = await run('docker', [
    'run', '--rm',
    '--add-host', 'host.docker.internal:host-gateway',
    '-e', `ZAP_APPLICANT_TOKEN=${applicant}`,
    '-e', `ZAP_STAFF_TOKEN=${staff}`,
    '-v', `${ROOT}:/zap/wrk/src:ro`,
    '-v', `${OUT}:/zap/wrk/out:rw`,
    ZAP, 'zap-api-scan.py',
    '-t', '/zap/wrk/src/packages/contracts/openapi/k-admission.v1.yaml',
    '-f', 'openapi',
    '-O', `http://host.docker.internal:${API_PORT}`,
    '-J', 'out/zap-report.json',
    '-r', 'out/zap-report.html',
    '-I', '-T', '5', '-s',
    '--hook=/zap/wrk/src/scripts/security/zap-auth-hook.py',
  ]);
  if (zap === null) throw new Error('ZAP 실행 실패');

  const high = await run(process.execPath, ['scripts/check-zap-report.mjs', path.join(OUT, 'zap-report.json')]);
  const auth = await run(process.execPath, ['scripts/security/check-dast-auth.mjs', `http://127.0.0.1:${METRICS}/metrics`]);
  code = high === 0 && auth === 0 ? 0 : 1;
} catch (err) {
  console.error('✘', err.message);
} finally {
  for (const p of procs) p.kill();
  spawnSync('docker', ['stop', PG], { stdio: 'ignore' });
}
console.log(`${code === 0 ? '✔' : '✘'} 토큰을 붙인 DAST → ${OUT}`);
process.exitCode = code;
