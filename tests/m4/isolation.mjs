// T-M4-42 — 대학 간 장애 격리 (로컬 축소 환경, kind 2 클러스터)
//
// 이 제품의 존재 이유를 확인한다: "한 대학이 전부 멈춰도 다른 대학 접수는 끝까지 된다."
//
//   1. 기준선 — A·B 둘 다 원서 생성 → 저장 → 결제 → (자동) 접수가 된다
//   2. A대 Data Plane 전면 정지 — A 클러스터 노드 컨테이너를 멈춘다
//   3. 그동안 B대 접수 전 구간이 된다 · 중앙 "내 원서" 에 B 접수가 반영된다 · A 는 응답하지 않는다
//   4. A 를 되살리면 A 접수도 다시 된다
//
// 전제: deploy/local 로 두 클러스터가 떠 있고(README), 대학 DB·중앙 API 가 호스트에 있다.
//   node tests/m4/isolation.mjs
//
// 결과는 tests/m4/results/isolation-<시각>.json 에 남긴다. 숫자(동시 접속·RPS)는 재지 않는다.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const UNIV = {
  A: { api: 'http://localhost:18081', node: 'univ-a-control-plane', db: 'wonseoro-dev-postgres-univ-a-1', dbName: 'univ_a' },
  B: { api: 'http://localhost:18082', node: 'univ-b-control-plane', db: 'wonseoro-dev-postgres-univ-b-1', dbName: 'univ_b' },
};
const CENTRAL = 'http://localhost:3000';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = { highSchool: '격리시험고등학교', graduationYear: 2026, selfIntro: '대학 간 장애 격리 시험용 자기소개입니다.' };

const log = [];
const note = (msg, extra = {}) => {
  const line = { at: new Date().toISOString(), msg, ...extra };
  log.push(line);
  console.log(`[${line.at.slice(11, 19)}] ${msg}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (p) => `${p}-${randomUUID()}`;

async function http(method, url, { headers = {}, body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 본문이 JSON 이 아니다 */ }
    return { status: res.status, json, headers: res.headers };
  } catch (err) {
    return { status: 0, error: err.name === 'AbortError' ? 'TIMEOUT' : String(err.cause?.code ?? err.message) };
  } finally {
    clearTimeout(t);
  }
}

/** 시험용 지원자. 지원자는 API 로 만들지 않는다(본인확인 절차) — 대학 DB 에 직접 넣는다. */
function newApplicant(u) {
  const id = randomUUID();
  const token = `subj-iso-${id.slice(0, 8)}`;
  execFileSync('docker', ['exec', '-i', u.db, 'psql', '-U', 'wonseoro', '-d', u.dbName, '-qAt', '-c',
    `SET search_path TO kadmission,public; INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${id}','${token}','\\x00','v1')`]);
  return { id, token };
}

/** 원서 생성 → 추가문항 저장 → 결제 의도 → 결제 확인(자동 접수) → 접수 조회 */
async function applyFlow(name) {
  const u = UNIV[name];
  const who = newApplicant(u);
  const h = { 'x-applicant-id': who.id, 'x-subject-token': who.token };
  const steps = {};
  const created = await http('POST', `${u.api}/api/v1/applications`, {
    headers: { ...h, 'idempotency-key': key('create') },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT },
  });
  steps.create = created.status || created.error;
  if (created.status !== 201) return { ok: false, steps };
  const appId = created.json.id;
  const saved = await http('PATCH', `${u.api}/api/v1/applications/${appId}`, {
    headers: { ...h, 'idempotency-key': key('save'), 'if-match': created.headers.get('etag'), 'content-type': 'application/merge-patch+json' },
    body: { fields: FIELDS },
  });
  steps.save = saved.status || saved.error;
  if (saved.status !== 200) return { ok: false, steps, detail: saved.json?.detail };
  const intent = await http('POST', `${u.api}/api/v1/applications/${appId}/payment-intents`, {
    headers: { ...h, 'idempotency-key': key('intent') },
  });
  steps.paymentIntent = intent.status || intent.error;
  if (intent.status !== 201) return { ok: false, steps, detail: intent.json?.detail };
  const verified = await http('POST', `${u.api}/api/v1/payments/${intent.json.paymentId}/verify`, {
    headers: { ...h, 'idempotency-key': key('verify') },
  });
  steps.verify = verified.status || verified.error;
  const sub = await http('GET', `${u.api}/api/v1/applications/${appId}/submission`, { headers: h });
  steps.submission = sub.status || sub.error;
  return { ok: sub.status === 200, steps, applicationNumber: sub.json?.applicationNumber, token: who.token };
}

async function waitReady(name, up, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await http('GET', `${UNIV[name].api}/readyz`, { timeoutMs: 3000 });
    if (up ? r.status === 200 : r.status === 0) return Date.now() - start;
    await sleep(2000);
  }
  throw new Error(`${name} 가 ${up ? '준비' : '정지'} 상태가 되지 않았다`);
}

/** 중앙 "내 원서" 에 이 지원자의 접수가 보일 때까지 (Outbox → Relay → 중앙) */
async function waitDashboard(token, applicationNumber, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await http('GET', `${CENTRAL}/api/v1/dashboard/applications`, { headers: { 'x-subject-token': token } });
    if (r.json?.applications?.some((a) => a.applicationNumber === applicationNumber)) return Date.now() - start;
    await sleep(2000);
  }
  return null;
}

const result = { test: 'T-M4-42', environment: 'local-kind-2-clusters (축소 환경)', startedAt: new Date().toISOString(), checks: {} };
const check = (name, pass, detail) => {
  result.checks[name] = { pass, ...detail };
  note(`${pass ? '✔' : '✖'} ${name}`, detail);
};

try {
  note('사전 확인');
  await waitReady('A', true, 30_000);
  await waitReady('B', true, 30_000);
  if ((await http('GET', `${CENTRAL}/readyz`)).status !== 200) throw new Error('중앙 API 가 떠 있지 않다');

  note('1. 기준선 — 두 대학 모두 접수');
  const a0 = await applyFlow('A');
  const b0 = await applyFlow('B');
  check('baseline-A', a0.ok, a0);
  check('baseline-B', b0.ok, b0);

  note('2. A대 Data Plane 전면 정지', { node: UNIV.A.node });
  execFileSync('docker', ['stop', UNIV.A.node]);
  const downAfter = await waitReady('A', false, 60_000);
  const aDown = await http('GET', `${UNIV.A.api}/readyz`, { timeoutMs: 3000 });
  check('A-is-down', aDown.status === 0, { observed: aDown.error ?? aDown.status, detectedMs: downAfter });

  note('3. A 정지 중 B대 접수 전 구간');
  const b1 = await applyFlow('B');
  check('B-submits-while-A-down', b1.ok, b1);
  const b2 = await applyFlow('B');
  check('B-submits-again-while-A-down', b2.ok, b2);
  const seenMs = b1.ok ? await waitDashboard(b1.token, b1.applicationNumber) : null;
  check('central-dashboard-shows-B-while-A-down', seenMs !== null, { seenAfterMs: seenMs });

  note('4. A 복구');
  execFileSync('docker', ['start', UNIV.A.node]);
  const upAfter = await waitReady('A', true);
  const a1 = await applyFlow('A');
  check('A-recovers-and-submits', a1.ok, { ...a1, recoveredAfterMs: upAfter });
} catch (err) {
  note(`중단: ${err.message}`);
  result.error = err.message;
  // A 를 멈춘 채로 두지 않는다
  try { execFileSync('docker', ['start', UNIV.A.node]); } catch { /* 이미 떠 있다 */ }
}

result.finishedAt = new Date().toISOString();
result.passed = !result.error && Object.values(result.checks).every((c) => c.pass);
result.log = log;
mkdirSync('tests/m4/results', { recursive: true });
const out = `tests/m4/results/isolation-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
note(`${result.passed ? '통과' : '실패'} — ${out}`);
process.exit(result.passed ? 0 : 1);
