// 접근 권한 부여·변경·말소 기록 — 실제 로그인 서버로 끝에서 끝까지 (개인정보의 안전성 확보조치 기준 제5조 ③, 문서 10 G-15, 대장 D-91)
//
// 사용: docker compose -f infra/compose/docker-compose.dev.yml --profile auth up -d --force-recreate keycloak   (렐름에 관리 이벤트·수집 클라이언트가 들어간 뒤 한 번)
//       CI 재현 DB(:5499, 0011 적용) · npm run build -w @wonseoro/admission-api
//       npm run test:auth:grants
// 실제 수집 도구(dist/tools/access-grant-sync.js)를 실행한다.
//   1. 처음 돌면 담당자 계정마다 기준 기록(수집 클라이언트의 읽기 권한까지) — 종료 코드 0
//   2. 로그인 서버 관리자가 역할을 주고 빼면 → 바꾼 관리자 계정 ID 와 함께 부여·회수 두 줄
//   3. 관리 이벤트를 끈 채 역할을 주면 → 수집이 실패(종료 코드 1)하면서도 대조 기록으로 그 권한을 남긴다
//   4. 다시 켜고 원래대로 돌리면 정상, 해시 체인 검증 통과(verify)
// 시험 뒤 조회자 계정 권한과 관리 이벤트 설정을 원래대로 돌린다. 결과는 tests/auth/results/access-grant-live-<시각>.json
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_BASE } from './helpers/login.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REALM = 'wonseoro-staff';
const ADMIN = `${ISSUER_BASE}/admin/realms/${REALM}`;
const VIEWER = '7a1c0001-0000-4000-8000-00000000a004';
const TOOL = path.join(ROOT, 'apps/admission-api/dist/tools/access-grant-sync.js');
const DB_APP = process.env.ACCESS_GRANT_DATABASE_URL ?? 'postgresql://kadmission_app:kadmission_app_dev@localhost:5499/univ_a';
const PG_CONTAINER = process.env.ACCESS_GRANT_PG_CONTAINER ?? 'ci-pg';

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok: !!ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

async function masterToken() {
  const res = await fetch(`${ISSUER_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'kcadmin', password: 'kcadmin-dev' }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`로그인 서버 관리자 토큰을 받지 못했다 (${res.status})`);
  return body.access_token;
}
let token = '';
const kc = async (method, p, body) => {
  const res = await fetch(`${ADMIN}/${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}`);
  return res.status === 204 ? null : res.json();
};
const setAdminEvents = async (on) => {
  const cfg = await kc('GET', 'events/config');
  await kc('PUT', 'events/config', { ...cfg, adminEventsEnabled: on, adminEventsDetailsEnabled: on });
};

/** 도구를 실제로 돌린다 — 종료 코드와 마지막 결과 줄 */
function tool(cmd = 'sync') {
  const r = spawnSync(process.execPath, [TOOL, cmd], {
    env: { ...process.env, DATABASE_URL: DB_APP, OIDC_STAFF_ISSUER: `${ISSUER_BASE}/realms/${REALM}`, NODE_ENV: 'development' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const json = [...out.matchAll(/\{"realm".*?"adminEventsEnabled":(?:true|false)\}/g)].at(-1)?.[0];
  return { code: r.status, result: json ? JSON.parse(json) : null, out };
}

/** 앱 계정이 아니라 관리자 계정으로 읽는다 — 시험이 앱 권한 밖을 보지 않게 docker psql */
function rows(where, params = []) {
  let sql = `SELECT json_agg(t ORDER BY seq) FROM (SELECT seq, action, change_kind, subject, roles, actor, details FROM kadmission.access_grant_log WHERE ${where}) t`;
  params.forEach((p, i) => (sql = sql.replaceAll(`$${i + 1}`, `'${String(p).replaceAll("'", "''")}'`)));
  const out = execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-qAt', '-U', 'wonseoro', '-d', 'univ_a', '-c', sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}
const maxSeq = () => Number(execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-qAt', '-U', 'wonseoro', '-d', 'univ_a', '-c', 'SELECT coalesce(max(seq), 0) FROM kadmission.access_grant_log'], { encoding: 'utf8' }).trim());

let support = null;
try {
  // 막 다시 만든 로그인 서버는 1분 남짓 뒤에 뜬다
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${ISSUER_BASE}/realms/${REALM}/.well-known/openid-configuration`).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  token = await masterToken();
  // 관리 이벤트의 바꾼 사람 = 마스터 렐름 관리자 계정 ID
  const me = (await (await fetch(`${ISSUER_BASE}/admin/realms/master/users?username=kcadmin&exact=true`, { headers: { authorization: `Bearer ${token}` } })).json())[0]?.id;
  support = await kc('GET', 'roles/support-agent');
  await setAdminEvents(true);

  // 1. 처음(또는 다시) 돌면 계정마다 기준 — 지금 기록과 같으면 새 줄이 없다
  const s0 = maxSeq();
  const first = tool();
  check(first.code === 0 && first.result?.adminEventsEnabled === true, `수집이 정상 종료(0) — ${JSON.stringify(first.result)}`);
  // 계정 목록은 서비스 계정을 숨긴다 — 수집 클라이언트의 서비스 계정은 따로
  const [client] = await kc('GET', 'clients?clientId=access-grant-collector');
  const collector = await kc('GET', `clients/${client.id}/service-account-user`);
  const users = [...(await kc('GET', 'users?max=100&briefRepresentation=true')), collector];
  const ids = new Set(users.map((u) => u.id));
  const known = rows(`subject = ANY(ARRAY[${[...ids].map((i) => `'${i}'`).join(',')}]) AND change_kind IN ('BASELINE','RECONCILED')`);
  check(users.every((u) => known.some((r) => r.subject === u.id)), `로그인 서버 계정 ${users.length}개(서비스 계정 포함) 모두 기준(또는 대조) 기록이 있다`);
  const colRow = known.filter((r) => r.subject === collector?.id).at(-1);
  check(colRow && ['realm-management:view-events', 'realm-management:view-realm', 'realm-management:view-users'].every((r) => colRow.roles.includes(r)),
    `수집 클라이언트 자신의 읽기 권한도 기록된다 — ${JSON.stringify(colRow?.roles)}`);
  const adminA = known.filter((r) => r.subject === '7a1c0001-0000-4000-8000-00000000a001').at(-1);
  check(adminA && JSON.stringify(adminA.roles) === JSON.stringify(['admission-admin']) && !JSON.stringify(adminA).includes('@'),
    `입학처 담당자 기준 — 역할만, 이메일 없음 (${JSON.stringify(adminA?.roles)})`);

  // 2. 관리자가 역할을 주고 뺀다 — 이벤트로 두 줄, 대조 기록 없음
  const s1 = maxSeq();
  await kc('POST', `users/${VIEWER}/role-mappings/realm`, [support]);
  await kc('DELETE', `users/${VIEWER}/role-mappings/realm`, [support]);
  const second = tool();
  const ev = rows(`seq > ${s1} AND subject = $1`, [VIEWER]);
  check(second.code === 0 && second.result?.eventsRecorded >= 2, `관리 이벤트 2건을 옮겼다 — ${JSON.stringify(second.result)}`);
  check(
    JSON.stringify(ev.map((r) => [r.action, r.change_kind, r.roles, r.actor])) ===
      JSON.stringify([['GRANT', 'ROLE_ADDED', ['support-agent'], me], ['REVOKE', 'ROLE_REMOVED', ['support-agent'], me]]),
    `부여·회수가 바꾼 관리자 계정 ID 와 함께 순서대로 — ${JSON.stringify(ev.map((r) => [r.change_kind, r.roles, r.actor === me]))}`,
  );
  const third = tool();
  check(third.code === 0 && third.result?.eventsRecorded === 0 && rows(`seq > ${s1} AND subject = $1`, [VIEWER]).length === 2, '다시 돌려도 같은 이벤트는 한 줄 — 새 줄 없음');

  // 3. 관리 이벤트를 끄고 권한을 준다 — 수집은 실패로 알리고, 대조 기록이 그 권한을 남긴다
  await setAdminEvents(false);
  const s2 = maxSeq();
  await kc('POST', `users/${VIEWER}/role-mappings/realm`, [support]);
  const off = tool();
  const rec = rows(`seq > ${s2} AND subject = $1`, [VIEWER]);
  check(off.code === 1 && off.result?.adminEventsEnabled === false, `관리 이벤트가 꺼져 있으면 수집이 실패(1)로 끝난다 — ${JSON.stringify(off.result)}`);
  check(rec.length === 1 && rec[0].change_kind === 'RECONCILED' && rec[0].action === 'GRANT' && JSON.stringify(rec[0].details.added) === '["support-agent"]' && rec[0].actor === null,
    `이벤트 없이 준 권한도 대조 기록으로 남는다(바꾼 사람 모름) — ${JSON.stringify(rec.map((r) => [r.action, r.change_kind, r.details.added]))}`);

  // 4. 다시 켜고 원래대로 — 회수 이벤트 한 줄, 정상 종료, 체인 검증
  await setAdminEvents(true);
  const s3 = maxSeq();
  await kc('DELETE', `users/${VIEWER}/role-mappings/realm`, [support]);
  const back = tool();
  const fix = rows(`seq > ${s3} AND subject = $1`, [VIEWER]);
  check(back.code === 0 && fix.length === 1 && fix[0].change_kind === 'ROLE_REMOVED', `다시 켜면 회수가 이벤트로 남고 대조 기록은 없다 — ${JSON.stringify(fix.map((r) => r.change_kind))}`);
  const v = tool('verify');
  check(v.code === 0 && /"brokenSeq":null/.test(v.out), `해시 체인 검증 통과 — ${(/\{"chain".*\}/.exec(v.out) ?? [''])[0]}`);
  check(maxSeq() > s0, `이번 시험 뒤 순번 ${s0} → ${maxSeq()}(이미 있는 이벤트를 거른 빈 순번 포함) — 기록은 지울 수 없어 그대로 둔다(시험 DB)`);
} catch (err) {
  check(false, `시험 중단: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 원래대로 — 조회자 계정은 platform-viewer 만, 관리 이벤트 켬
  try {
    if (support) await kc('DELETE', `users/${VIEWER}/role-mappings/realm`, [support]).catch(() => undefined);
    await setAdminEvents(true);
  } catch {
    /* 정리 실패는 위 결과에 이미 드러난다 */
  }
}

const dir = path.join(ROOT, 'tests/auth/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `access-grant-live-${new Date().toISOString().replaceAll(':', '-')}.json`);
writeFileSync(file, JSON.stringify({ test: 'access-grant-live', issuer: ISSUER_BASE, durationMs: Date.now() - started, passed: problems.length === 0, steps, problems }, null, 2));
console.log(`\n${problems.length === 0 ? '통과' : `실패 ${problems.length}`} — ${steps.length}개 확인 · ${file}`);
process.exit(problems.length === 0 ? 0 : 1);
