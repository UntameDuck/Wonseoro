// 복구 검증 — 백업을 새 DB 에 복구하고 원본과 맞춘다 (T-M5-62, 노션 §01 B10 "월별 자동 복구 + checksum/row-count/업무 invariant")
//
// 사용: node scripts/ops/restore-verify.mjs --source=<관리자 DB URL> [--schema=kadmission] [--image=postgres:16-alpine]
//   기본 source 는 CI 재현 DB(postgresql://wonseoro:wonseoro@localhost:5499/univ_a)
// 하는 일
//   1. 원본에서 REPEATABLE READ 트랜잭션을 열고 스냅숏을 내보낸다 — 덤프와 원본 체크섬이 **같은 시점**을 본다
//   2. 그 스냅숏으로 pg_dump(-Fc) → 새 PostgreSQL 컨테이너에 pg_restore(복구 대상은 매번 새로 — 남은 것이 결과를 속이지 않게)
//   3. 표마다 행 수·체크섬(행 글자를 정렬해 md5) 원본 = 복구본
//   4. 복구본에서 업무 불변식 — 접수 1건/원서, 접수된 원서는 FINALIZED·확정 결제, Outbox 순번 유일, 감사 체인의 앞 해시 연결,
//      DB 제약 검사(infra/db/verify-constraints.sql — 롤백되는 검사)
// 운영: 원본 대신 백업 저장소(PITR 기본 백업 + WAL)에서 복구한 DB 를 같은 검사에 넣는다(T-M5-61). 결과는 tests/ops/results/restore-verify-<시각>.json
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const SOURCE = arg('source', process.env.RESTORE_SOURCE_URL ?? 'postgresql://wonseoro:wonseoro@localhost:5499/univ_a');
const SCHEMA = arg('schema', 'kadmission');
const IMAGE = arg('image', 'postgres:16-alpine');
const NAME = `restore-verify-${Date.now()}`;
const PORT = Number(arg('port', '5498'));
// 컨테이너 안 pg_dump 가 원본에 닿는 주소(로컬 → host.docker.internal, CI 서비스 → 그대로)
const DUMP_URL = arg('dump-url', process.env.RESTORE_DUMP_URL ?? SOURCE.replace(/@(localhost|127\.0\.0\.1):/, '@host.docker.internal:'));

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

/** 표마다 행 수·체크섬 */
async function fingerprint(client) {
  const tables = (
    await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`,
      [SCHEMA],
    )
  ).rows.map((r) => r.relname);
  const out = {};
  for (const t of tables) {
    const r = await client.query(`SELECT count(*)::bigint AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${SCHEMA}.${t} x`);
    out[t] = { rows: Number(r.rows[0].n), md5: r.rows[0].h };
  }
  return out;
}

const INVARIANTS = [
  ['접수는 원서마다 하나', `SELECT count(*) FROM (SELECT application_id FROM submission GROUP BY 1 HAVING count(*) > 1) x`],
  ['접수된 원서는 모두 FINALIZED', `SELECT count(*) FROM submission s JOIN application a ON a.id = s.application_id WHERE a.status <> 'FINALIZED'`],
  ['FINALIZED 원서는 모두 접수 기록이 있다', `SELECT count(*) FROM application a WHERE a.status = 'FINALIZED' AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.application_id = a.id)`],
  ['접수된 원서는 확정 결제가 있다', `SELECT count(*) FROM submission s WHERE NOT EXISTS (SELECT 1 FROM payment p WHERE p.application_id = s.application_id AND p.status = 'CONFIRMED')`],
  ['Outbox 순번은 원서마다 유일', `SELECT count(*) FROM (SELECT aggregate_id, aggregate_sequence FROM outbox_event GROUP BY 1,2 HAVING count(*) > 1) x`],
  ['감사 체인 — 앞 해시가 같은 원서의 기록을 가리킨다',
    `SELECT count(*) FROM audit_event e WHERE e.prev_hash IS NOT NULL AND e.prev_hash <> repeat('0', 64)
       AND NOT EXISTS (SELECT 1 FROM audit_event p WHERE p.event_hash = e.prev_hash AND p.application_id IS NOT DISTINCT FROM e.application_id)`],
];

const source = new pg.Client({ connectionString: SOURCE });
let restored = null;
try {
  await source.connect();
  // 1. 같은 시점
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (await source.query('SELECT pg_export_snapshot() AS s')).rows[0].s;
  const want = await fingerprint(source);
  check(Object.keys(want).length > 0, `원본 스냅숏 — 표 ${Object.keys(want).length}개`, { snapshot });

  // 2. 덤프 → 새 DB 에 복구
  execFileSync('docker', ['run', '-d', '--rm', '--name', NAME, '-e', 'POSTGRES_USER=wonseoro', '-e', 'POSTGRES_PASSWORD=wonseoro', '-e', 'POSTGRES_DB=restored', '-p', `${PORT}:5432`, IMAGE], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', NAME, 'pg_isready', '-U', 'wonseoro', '-d', 'restored'], { env }).status === 0) break;
    await sleep(1000);
  }
  await sleep(2000);
  // 원본의 역할(소유자·권한 대상)을 복구 대상에도 — 역할은 클러스터 전역이라 덤프에 없다
  for (const role of ['kadmission_app', 'kadmission_migrator', 'kadmission_auditor', 'kadmission_break_glass']) {
    spawnSync('docker', ['exec', NAME, 'psql', '-U', 'wonseoro', '-d', 'restored', '-c', `CREATE ROLE ${role} NOLOGIN`], { env });
  }
  const t0 = Date.now();
  const dump = spawnSync('docker', ['run', '--rm', IMAGE, 'pg_dump', '-Fc', `--snapshot=${snapshot}`, '--dbname', DUMP_URL], { env, maxBuffer: 1 << 30 });
  if (dump.status !== 0) throw new Error(`pg_dump 실패: ${dump.stderr.toString().slice(0, 300)}`);
  const rest = spawnSync('docker', ['exec', '-i', NAME, 'pg_restore', '-U', 'wonseoro', '-d', 'restored', '--exit-on-error'], { env, input: dump.stdout, maxBuffer: 1 << 30 });
  check(rest.status === 0, '덤프를 새 DB 에 복구', { dumpBytes: dump.stdout.length, seconds: Math.round((Date.now() - t0) / 100) / 10, error: rest.status === 0 ? undefined : rest.stderr.toString().slice(0, 300) });
  await source.query('COMMIT');

  // 3. 행 수·체크섬
  restored = new pg.Client({ connectionString: `postgresql://wonseoro:wonseoro@localhost:${PORT}/restored` });
  await restored.connect();
  const got = await fingerprint(restored);
  const diff = Object.keys(want).filter((t) => !got[t] || got[t].rows !== want[t].rows || got[t].md5 !== want[t].md5);
  const totalRows = Object.values(want).reduce((a, b) => a + b.rows, 0);
  check(diff.length === 0, `표 ${Object.keys(want).length}개 행 수·체크섬이 원본과 같다(행 ${totalRows})`, diff.length ? diff.map((t) => ({ t, want: want[t], got: got[t] ?? null })) : undefined);

  // 3b. 자기 시험 — 복구본 한 행을 바꾸면 이 검사가 잡는가(검사가 늘 "같다" 고만 하면 의미가 없다)
  const victim = Object.keys(got).find((t) => got[t].rows > 0 && t !== 'audit_event' && t !== 'activation_record' && t !== 'break_glass_access');
  if (victim) {
    const col = (await restored.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND data_type IN ('timestamp with time zone','integer','bigint') AND is_nullable = 'NO' ORDER BY ordinal_position LIMIT 1`,
      [SCHEMA, victim],
    )).rows[0]?.column_name;
    if (col) {
      await restored.query('BEGIN');
      await restored.query(`SET LOCAL session_replication_role = replica`);
      const bump = /timestamp/.test((await restored.query(`SELECT pg_typeof(${col})::text AS t FROM ${SCHEMA}.${victim} LIMIT 1`)).rows[0].t) ? `${col} + interval '1 second'` : `${col} + 1`;
      await restored.query(`UPDATE ${SCHEMA}.${victim} SET ${col} = ${bump} WHERE ctid = (SELECT ctid FROM ${SCHEMA}.${victim} LIMIT 1)`);
      const after = await fingerprint(restored);
      await restored.query('ROLLBACK');
      check(after[victim].md5 !== want[victim].md5, `자기 시험 — 복구본 한 행을 바꾸면 체크섬이 달라진다(${victim}.${col})`);
    }
  }

  // 4. 업무 불변식·DB 제약
  await restored.query(`SET search_path TO ${SCHEMA}, public`);
  for (const [what, sql] of INVARIANTS) {
    const n = Number((await restored.query(sql)).rows[0].count);
    check(n === 0, `불변식: ${what}`, n ? { violations: n } : undefined);
  }
  const verify = spawnSync('docker', ['exec', '-i', NAME, 'psql', '-U', 'wonseoro', '-d', 'restored', '-v', 'ON_ERROR_STOP=1', '-q'], {
    env,
    input: readFileSync(path.join(ROOT, 'infra/db/verify-constraints.sql')),
  });
  const notices = verify.stderr.toString();
  const passCount = (notices.match(/PASS/g) ?? []).length;
  check(verify.status === 0 && !/FAIL/.test(notices), `DB 제약 검사(verify-constraints) — PASS ${passCount}`, verify.status === 0 ? undefined : notices.slice(-400));
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  await source.end().catch(() => undefined);
  await restored?.end().catch(() => undefined);
  spawnSync('docker', ['rm', '-f', NAME], { env });
}

const result = {
  test: '복구 검증 — 덤프·복구·행 수·체크섬·업무 불변식 (T-M5-62)',
  environment: process.env.GITHUB_ACTIONS ? 'CI — 시드 DB' : '축소 환경 — 로컬 DB',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/ops/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `restore-verify-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 복구 검증 ${steps.length}개 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exit(result.passed ? 0 : 1);
