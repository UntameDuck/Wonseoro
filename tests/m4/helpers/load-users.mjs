// 노드 장애 시험의 부하 생성기 — kind Docker 네트워크 안의 컨테이너에서 돈다 (T-M4-39, ADR-0008)
//
// 왜 따로 도나: Windows 호스트에서 Docker Desktop 포트 전달(localhost:18082)을 거치면, kind 노드 컨테이너 하나를
// 멈출 때 그 전달이 50초 넘게 막혔다 — 클러스터 안 NodePort·Pod 는 멀쩡했는데 호스트 요청만 전부 timeout
// (2026-09-30 구간별 측정). 그 결과를 노드 장애 탓으로 셀 수 없어, 부하는 제어 노드의 NodePort 를 같은
// Docker 네트워크에서 직접 부른다.
//
//   docker run --rm -i --network kind -e API=http://univ-m-control-plane:30081 -e IDENTITIES='[...]' \
//     -v <repo>/tests/m4/helpers:/h:ro node:22-alpine node /h/load-users.mjs
//
// stdin: 한 줄에 단계 이름 하나(baseline·drain…), "stop" 이면 끝낸다.
// stdout: 요청 하나당 JSON 한 줄 {phase, at, kind, firstOk, finalOk, ...}. 시각은 이 컨테이너의 시계다.
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const API = process.env.API;
const identities = JSON.parse(process.env.IDENTITIES);
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';

let phase = 'setup';
let running = true;
createInterface({ input: process.stdin }).on('line', (line) => {
  const next = line.trim();
  if (next === 'stop') running = false;
  else if (next) {
    phase = next;
    process.stdout.write(`${JSON.stringify({ phaseAt: next, at: Date.now() })}\n`);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 요청마다 새 TCP 연결(agent: false) — keep-alive 면 kube-proxy 가 연결 단위로만 나눠 한 Pod 로 몰린다 */
function attempt(identity, method, path, headers = {}, body, timeoutMs = 2_000) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = httpRequest(`${API}${path}`, {
      method, agent: false, timeout: timeoutMs,
      headers: { 'content-type': 'application/json', ...identity, ...headers, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
        resolve({ status: res.statusCode ?? 0, json, etag: res.headers.etag ?? null });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ status: 0, error: error.message === 'timeout' ? 'timeout' : String(error.code ?? error.message) }));
    if (payload) req.write(payload);
    req.end();
  });
}
const transient = (r) => r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;

/** 같은 요청(같은 멱등키)을 1초 간격 최대 3번 — 브라우저 자동저장과 같다 */
async function withRetry(fn) {
  let first;
  for (let i = 0; i < 3; i += 1) {
    const r = await fn();
    first ??= r;
    if (!transient(r)) return { first, final: r, attempts: i + 1 };
    await sleep(1_000);
  }
  return { first, final: { status: 0, error: 'gave-up' }, attempts: 3 };
}

async function user(identity) {
  const id = { 'x-applicant-id': identity.applicantId, 'x-subject-token': identity.subjectToken };
  const created = await attempt(id, 'POST', '/api/v1/applications', { 'idempotency-key': `node-create-${randomUUID()}` },
    { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT }, 30_000);
  const appId = created.json?.id;
  if (!appId) throw new Error(`원서 생성 실패 ${created.status} ${created.error ?? ''}`);
  let etag = (await attempt(id, 'GET', `/api/v1/applications/${appId}`, {}, undefined, 30_000)).etag;
  let n = 0;
  while (running) {
    const started = Date.now();
    const current = phase;
    let r;
    const isSave = n % 3 === 2;
    if (!isSave) {
      r = await withRetry(() => attempt(id, 'GET', `/api/v1/applications/${appId}`));
      if (r.final.etag) etag = r.final.etag;
    } else {
      const key = `node-save-${randomUUID()}`;
      r = await withRetry(() => attempt(id, 'PATCH', `/api/v1/applications/${appId}`,
        { 'idempotency-key': key, 'if-match': etag, 'content-type': 'application/merge-patch+json' },
        { fields: { highSchool: '노드 장애 시험 고등학교', graduationYear: 2026, academicNote: `저장 ${n}` } }));
      if (r.final.etag) etag = r.final.etag;
      if (r.final.status === 412) etag = (await attempt(id, 'GET', `/api/v1/applications/${appId}`)).etag ?? etag;
    }
    process.stdout.write(`${JSON.stringify({ phase: current, at: started, kind: isSave ? 'save' : 'read',
      firstOk: !transient(r.first), finalOk: !transient(r.final), finalStatus: r.final.status, finalCode: r.final.json?.code, attempts: r.attempts,
      firstError: r.first.error ?? `${r.first.status} ${r.first.json?.code ?? ''}` })}\n`);
    n += 1;
    await sleep(Math.max(0, 1_000 - (Date.now() - started)));
  }
}

await Promise.all(identities.map((i) => user(i)));
// stdin 을 읽는 readline 이 이벤트 루프를 붙잡아 두므로 직접 끝낸다
process.stdout.write('{"done":true}\n', () => process.exit(0));
