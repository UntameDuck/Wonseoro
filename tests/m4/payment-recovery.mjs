// T-M4-34 — PG 지연·UNKNOWN 후 자동 재확인 및 접수
//
// 로컬 kind 축소 환경에서 Mock PG를 SLOW와 UNKNOWN→OK로 바꾸며 확인한다.
// 워커 주기는 1초로, 결제별 30초 Backoff는 DB 시각을 당겨 시간 압축한다.
// 시험이 끝나면 UNIV-A Helm release를 원래 로컬 values(2 replicas, 강제 PG 동작 없음)로 복구한다.
//
//   node tests/m4/payment-recovery.mjs
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const DB_NAME = 'univ_a';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const FIELDS = {
  highSchool: 'PG 재확인 시험 고등학교',
  graduationYear: 2026,
  academicNote: 'PG 지연과 상태 미확정 후 자동 정합화 시험입니다.',
};
const BASE_VALUES = ['deploy/local/values-local.yaml', 'deploy/local/values-univ-a.yaml'];

const result = {
  test: 'T-M4-34',
  environment: 'local-kind-univ-a (축소·시간 압축 환경)',
  timeCompression: 'worker 1초, 결제별 30초 Backoff는 verified_at을 35초 과거로 이동',
  startedAt: new Date().toISOString(),
  checks: {},
  scenarios: {},
};

function run(program, args, options = {}) {
  return execFileSync(program, args, { cwd: process.cwd(), encoding: 'utf8', stdio: options.quiet ? 'pipe' : 'inherit' });
}

function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', DB_NAME, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`],
    { encoding: 'utf8' },
  ).trim();
}

function helmArgs(extra = []) {
  const args = ['upgrade', '--install', 'univ-a', 'deploy/charts/k-admission', '--kube-context', 'kind-univ-a', '-n', 'kadmission-app', '--create-namespace'];
  for (const file of BASE_VALUES) args.push('-f', file);
  return [...args, ...extra];
}

async function deployBehaviour(behaviour) {
  console.log(`\n[deploy] Mock PG ${behaviour}`);
  run('helm', helmArgs([
    '--set', 'api.replicas=1',
    '--set-string', `api.env.MOCK_PG_BEHAVIOUR=${behaviour}`,
    '--set-string', 'api.env.PAYMENT_RECHECK_INTERVAL_MS=1000',
  ]));
  run('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'rollout', 'status', 'deployment/univ-a-api', '--timeout=180s']);
  waitStablePods(1, behaviour);
  await waitApiReady();
}

async function restoreDeployment() {
  console.log('\n[restore] UNIV-A local values');
  run('helm', helmArgs());
  run('kubectl', ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'rollout', 'status', 'deployment/univ-a-api', '--timeout=180s']);
  waitStablePods(2, null);
  await waitApiReady();
}

/**
 * rollout status는 preStop 중인 옛 Pod가 Service endpoint에서 완전히 사라지기 전에 끝날 수 있다.
 * PG 동작을 바꾸는 시험이 옛 Pod로 라우팅되지 않도록, 삭제 중 Pod가 0개가 될 때까지 기다린다.
 */
function waitStablePods(expected, behaviour) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const raw = run(
      'kubectl',
      ['--context', 'kind-univ-a', '-n', 'kadmission-app', 'get', 'pods', '-l', 'app=admission-api', '-o', 'json'],
      { quiet: true },
    );
    const pods = JSON.parse(raw).items;
    const stable = pods.filter((pod) => !pod.metadata.deletionTimestamp);
    const ready = stable.every((pod) => pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'));
    const envMatches = stable.every((pod) => {
      const env = pod.spec.containers[0].env ?? [];
      const actual = env.find((item) => item.name === 'MOCK_PG_BEHAVIOUR')?.value ?? null;
      return actual === behaviour;
    });
    if (pods.length === expected && stable.length === expected && ready && envMatches) return;
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 750']);
  }
  throw new Error(`API Pod이 안정 상태가 되지 않았습니다 (expected=${expected}, behaviour=${behaviour ?? 'default'})`);
}

async function waitApiReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await http('GET', '/readyz', { timeoutMs: 3000 });
    if (ready.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('NodePort로 UNIV-A API readiness를 확인하지 못했습니다');
}

async function http(method, path, { headers = {}, body, timeoutMs = 30_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON 아닌 오류 응답 */ }
    return { status: response.status, json, headers: response.headers };
  } catch (error) {
    return { status: 0, error: error.name === 'AbortError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message) };
  } finally {
    clearTimeout(timer);
  }
}

async function prepare(label) {
  const applicantId = randomUUID();
  const subjectToken = `subj-m4-34-${label}-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const identity = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const created = await http('POST', '/api/v1/applications', {
    headers: { ...identity, 'idempotency-key': `m4-34-create-${randomUUID()}` },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT, consents: ['APPLICATION_COLLECTION', 'SCHOOL_RECORD_PROVISION'] },
  });
  if (created.status !== 201) throw new Error(`${label}: create failed ${created.status}`);
  const applicationId = created.json.id;
  const saved = await http('PATCH', `/api/v1/applications/${applicationId}`, {
    headers: {
      ...identity,
      'idempotency-key': `m4-34-save-${randomUUID()}`,
      'if-match': created.headers.get('etag'),
      'content-type': 'application/merge-patch+json',
    },
    body: { fields: FIELDS },
  });
  if (saved.status !== 200) throw new Error(`${label}: save failed ${saved.status}`);
  const intent = await http('POST', `/api/v1/applications/${applicationId}/payment-intents`, {
    headers: { ...identity, 'idempotency-key': `m4-34-intent-${randomUUID()}` },
  });
  if (intent.status !== 201) throw new Error(`${label}: intent failed ${intent.status}`);
  return { applicationId, paymentId: intent.json.paymentId, identity };
}

function makeDue(paymentId) {
  sql(`UPDATE payment SET verified_at=now()-interval '35 seconds', updated_at=now()-interval '35 seconds' WHERE id='${paymentId}'`);
}

async function waitFinalized(candidate, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payment = await http('GET', `/api/v1/payments/${candidate.paymentId}`, { headers: candidate.identity });
    const submission = await http('GET', `/api/v1/applications/${candidate.applicationId}/submission`, { headers: candidate.identity });
    if (payment.json?.status === 'CONFIRMED' && submission.status === 200) {
      return { elapsedMs: Date.now() - started, payment: payment.json, submission: submission.json };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function counts(candidate) {
  const [confirmedEvents, submissions, finalizedAudits] = sql(
    `SELECT
       (SELECT count(*) FROM payment_event WHERE payment_id='${candidate.paymentId}' AND event_type='VERIFY_CONFIRMED'),
       (SELECT count(*) FROM submission WHERE application_id='${candidate.applicationId}'),
       (SELECT count(*) FROM audit_event WHERE application_id='${candidate.applicationId}' AND action='APPLICATION_FINALIZED' AND result='ACCEPTED')`,
  ).split('|').map(Number);
  return { confirmedEvents, submissions, finalizedAudits };
}

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

let restored = false;
try {
  await deployBehaviour('SLOW');
  const slow = await prepare('slow');
  const firstSlow = await http('POST', `/api/v1/payments/${slow.paymentId}/verify`, {
    headers: { ...slow.identity, 'idempotency-key': `m4-34-verify-${randomUUID()}` },
  });
  check('SLOW-first-check-is-pending', firstSlow.status === 202 && firstSlow.json?.status === 'PENDING', {
    httpStatus: firstSlow.status,
    paymentStatus: firstSlow.json?.status,
  });
  makeDue(slow.paymentId);
  const slowFinal = await waitFinalized(slow);
  const slowCounts = counts(slow);
  result.scenarios.SLOW = { applicationId: slow.applicationId, paymentId: slow.paymentId, recovered: slowFinal, counts: slowCounts };
  check('SLOW-worker-auto-confirms-and-finalizes', Boolean(slowFinal), { elapsedMs: slowFinal?.elapsedMs ?? null });
  check('SLOW-double-confirm-is-zero', slowCounts.confirmedEvents === 1 && slowCounts.submissions === 1 && slowCounts.finalizedAudits === 1, slowCounts);

  await deployBehaviour('UNKNOWN');
  const unknown = await prepare('unknown');
  const firstUnknown = await http('POST', `/api/v1/payments/${unknown.paymentId}/verify`, {
    headers: { ...unknown.identity, 'idempotency-key': `m4-34-verify-${randomUUID()}` },
  });
  check('UNKNOWN-is-not-treated-as-failure-or-success', firstUnknown.status === 202 && firstUnknown.json?.status === 'UNKNOWN', {
    httpStatus: firstUnknown.status,
    paymentStatus: firstUnknown.json?.status,
  });
  makeDue(unknown.paymentId);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const beforeRecovery = await http('GET', `/api/v1/applications/${unknown.applicationId}/submission`, { headers: unknown.identity });
  check('UNKNOWN-does-not-finalize', beforeRecovery.status !== 200, { submissionStatus: beforeRecovery.status });

  // PG가 다시 응답 가능한 상태가 된 것을 새 Pod의 OK 동작으로 재현한다.
  await deployBehaviour('OK');
  makeDue(unknown.paymentId);
  const unknownFinal = await waitFinalized(unknown);
  const unknownCounts = counts(unknown);
  result.scenarios.UNKNOWN_RECOVERY = {
    applicationId: unknown.applicationId,
    paymentId: unknown.paymentId,
    recovered: unknownFinal,
    counts: unknownCounts,
  };
  check('UNKNOWN-worker-recovers-after-PG-restores', Boolean(unknownFinal), { elapsedMs: unknownFinal?.elapsedMs ?? null });
  check('UNKNOWN-double-confirm-is-zero', unknownCounts.confirmedEvents === 1 && unknownCounts.submissions === 1 && unknownCounts.finalizedAudits === 1, unknownCounts);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
} finally {
  try {
    await restoreDeployment();
    restored = true;
  } catch (error) {
    result.restoreError = error instanceof Error ? error.message : String(error);
  }
}

check('deployment-restored', restored, { restored });
result.finishedAt = new Date().toISOString();
result.passed = !result.error && !result.restoreError && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/payment-recovery-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
