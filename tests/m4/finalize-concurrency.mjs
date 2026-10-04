// T-M4-33 — 동일 Application Finalize 100회 동시 요청
//
// 로컬 kind 축소 환경에서 같은 PAID 원서에 서로 다른 Idempotency-Key로
// 100개 요청을 동시에 보내도 Submission·Outbox·접수 감사 기록이 하나인지 확인한다.
// 결제 확인 API는 D-42에 따라 즉시 자동 접수하므로, 경합 시작점(PAID)을 만들기 위해
// 시험 데이터의 Payment와 Application 상태만 대학 DB에서 직접 준비한다.
//
// 전제: deploy/local의 univ-a와 로컬 DB가 떠 있어야 한다.
//   node tests/m4/finalize-concurrency.mjs
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
  highSchool: '동시 접수 시험 고등학교',
  graduationYear: 2026,
  academicNote: '동일 원서의 Finalize 100회 동시 요청 시험입니다.',
};

const result = {
  test: 'T-M4-33',
  environment: 'local-kind-univ-a (축소 환경)',
  startedAt: new Date().toISOString(),
  checks: {},
};

function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', DB_NAME, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`],
    { encoding: 'utf8' },
  ).trim();
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
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, error: error.name === 'AbortError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message) };
  } finally {
    clearTimeout(timer);
  }
}

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

try {
  const ready = await http('GET', '/readyz');
  if (ready.status !== 200) throw new Error(`UNIV-A API not ready: ${ready.status || ready.error}`);

  const applicantId = randomUUID();
  const subjectToken = `subj-m4-33-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const identity = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };

  const created = await http('POST', '/api/v1/applications', {
    headers: { ...identity, 'idempotency-key': `m4-33-create-${randomUUID()}` },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT },
  });
  if (created.status !== 201) throw new Error(`application create failed: ${created.status}`);
  const applicationId = created.json.id;

  const detail = await fetch(`${API}/api/v1/applications/${applicationId}`, { headers: identity });
  const etag = detail.headers.get('etag');
  if (!etag) throw new Error('application ETag missing');
  const saved = await http('PATCH', `/api/v1/applications/${applicationId}`, {
    headers: {
      ...identity,
      'idempotency-key': `m4-33-save-${randomUUID()}`,
      'if-match': etag,
      'content-type': 'application/merge-patch+json',
    },
    body: { fields: FIELDS },
  });
  if (saved.status !== 200) throw new Error(`application save failed: ${saved.status}`);

  const intent = await http('POST', `/api/v1/applications/${applicationId}/payment-intents`, {
    headers: { ...identity, 'idempotency-key': `m4-33-intent-${randomUUID()}` },
  });
  if (intent.status !== 201) throw new Error(`payment intent failed: ${intent.status}`);
  const paymentId = intent.json.paymentId;

  // PG 확인 후 자동 접수 listener가 불리기 직전의 영속 상태를 재현한다.
  sql(`UPDATE payment SET status='CONFIRMED', provider_approved_at=now(), verified_at=now(), updated_at=now() WHERE id='${paymentId}'; UPDATE application SET status='PAID', updated_at=now() WHERE id='${applicationId}'`);

  const started = performance.now();
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      http('POST', `/api/v1/applications/${applicationId}/finalize`, {
        headers: { ...identity, 'idempotency-key': `m4-33-finalize-${index}-${randomUUID()}` },
      }),
    ),
  );
  const elapsedMs = Math.round(performance.now() - started);
  const statuses = responses.reduce((acc, response) => {
    const key = String(response.status || response.error);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const successful = responses.filter((response) => response.status === 200 || response.status === 201);
  const submissionIds = new Set(successful.map((response) => response.json?.submissionId).filter(Boolean));
  const applicationNumbers = new Set(successful.map((response) => response.json?.applicationNumber).filter(Boolean));

  const [submissionCount, outboxCount, auditCount, state] = sql(
    `SELECT
       (SELECT count(*) FROM submission WHERE application_id='${applicationId}'),
       (SELECT count(*) FROM outbox_event WHERE aggregate_id='${applicationId}' AND event_type='kr.kadmission.application.finalized.v1'),
       (SELECT count(*) FROM audit_event WHERE application_id='${applicationId}' AND action='APPLICATION_FINALIZED' AND result='ACCEPTED'),
       (SELECT status FROM application WHERE id='${applicationId}')`,
  ).split('|');

  check('all-100-requests-succeeded', successful.length === 100, { statuses, elapsedMs });
  check('all-responses-return-same-submission', submissionIds.size === 1 && applicationNumbers.size === 1, {
    submissionIds: [...submissionIds],
    applicationNumbers: [...applicationNumbers],
  });
  check('single-submission-row', Number(submissionCount) === 1, { count: Number(submissionCount) });
  check('single-finalized-outbox-event', Number(outboxCount) === 1, { count: Number(outboxCount) });
  check('single-finalized-audit-event', Number(auditCount) === 1, { count: Number(auditCount) });
  check('application-is-finalized', state === 'FINALIZED', { state });

  result.applicationId = applicationId;
  result.requestCount = 100;
  result.elapsedMs = elapsedMs;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
}

result.finishedAt = new Date().toISOString();
result.passed = !result.error && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/finalize-concurrency-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
