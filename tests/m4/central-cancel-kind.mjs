// D-50 로컬 축소 검증 — 접수 전 취소가 중앙까지 반영되는가
//
// 전제: kind-univ-a 의 admission-api·event-relay 와 클러스터 밖 중앙(ka-central)이 D-50 이후 이미지다.
//
//   node tests/m4/central-cancel-kind.mjs
//
// 원서 생성 → 취소(사유 문장 포함) → Outbox 가 SENT 가 될 때까지 기다린다 → 중앙 요약이 CANCELLED 인지,
// 중앙 어디에도 대학 내부 원서 UUID·취소 사유가 없는지 본다. 전에는 중앙이 400 으로 거절해 DEAD 가 됐다.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const REASON = '가정 형편으로 지원을 포기합니다 (D-50 시험)';

const result = {
  test: 'D-50',
  scenario: '접수 전 취소 → Outbox → 중앙 Sync Gateway → 요약 CANCELLED',
  environment: 'local-kind-univ-a + ka-central (축소 환경)',
  startedAt: new Date().toISOString(),
  checks: {},
};
const check = (name, pass, detail = {}) => {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
};
const psql = (container, db, statement) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'wonseoro', '-d', db,
  '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
const univ = (s) => psql('wonseoro-dev-postgres-univ-a-1', 'univ_a', `SET search_path TO kadmission,public; ${s}`);
const central = (s) => psql('wonseoro-dev-postgres-central-1', 'central', `SET search_path TO kadmission_central, public; ${s}`);

async function http(method, path, { headers = {}, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const applicantId = randomUUID();
const subjectToken = `subj-d50-${applicantId.slice(0, 8)}`;
univ(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
const id = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };

const created = await http('POST', '/api/v1/applications', {
  headers: { ...id, 'idempotency-key': `d50-create-${randomUUID()}` },
  body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT },
});
const applicationId = created.json?.id;
const cancelled = await http('POST', `/api/v1/applications/${applicationId}/cancel`, {
  headers: { ...id, 'idempotency-key': `d50-cancel-${randomUUID()}` }, body: { reason: REASON },
});
check('원서 생성·취소', created.status === 201 && cancelled.status === 200, { create: created.status, cancel: cancelled.status });

let row = '';
for (let i = 0; i < 40; i += 1) {
  row = univ(`SELECT status || '|' || (payload->>'applicationId') FROM outbox_event WHERE aggregate_id='${applicationId}' AND event_type='kr.kadmission.application.cancelled.v1'`);
  if (row.startsWith('SENT') || row.startsWith('DEAD')) break;
  await new Promise((r) => setTimeout(r, 1_500));
}
const [outboxStatus, opaqueId] = row.split('|');
check('Outbox 취소 이벤트가 중앙 ACK 로 SENT', outboxStatus === 'SENT', { outboxStatus });

const summary = central(`SELECT status || '|' || last_sequence FROM application_summary WHERE application_id='${opaqueId}'`);
check('중앙 요약이 CANCELLED', summary.startsWith('CANCELLED|'), { summary });

const leaked = central(`SELECT count(*) FROM received_event WHERE aggregate_id='${applicationId}'`)
  + '/' + central(`SELECT count(*) FROM application_summary WHERE application_id='${applicationId}'`);
check('중앙에 대학 내부 원서 UUID 가 없다', leaked === '0/0', { internalIdRows: leaked });
check('중앙으로 간 본문에 취소 사유 문장이 없다',
  !univ(`SELECT payload::text FROM outbox_event WHERE aggregate_id='${applicationId}'`).includes('가정 형편'), {});

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/central-cancel-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
