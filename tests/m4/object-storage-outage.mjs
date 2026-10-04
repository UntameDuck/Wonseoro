// T-M4-38 — Object Storage 장애 중 비서류 흐름 지속
//
// MinIO를 잠시 멈춘 동안 카탈로그 조회·원서 생성·자동저장이 계속되고, 브라우저의
// 직접 업로드만 실패하는지 확인한다. 복구 후 같은 단기 URL로 업로드·서버측 검증까지
// 완료한다. 로컬 kind 축소 환경 결과이며 운영 지연 수치로 쓰지 않는다.
//
//   node tests/m4/object-storage-outage.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:18081';
const MINIO = 'http://localhost:9000';
const MINIO_CONTAINER = 'wonseoro-dev-minio-1';
const DB = 'wonseoro-dev-postgres-univ-a-1';
const CYCLE = '11111111-1111-1111-1111-111111111111';
const TYPE = '22222222-2222-2222-2222-222222222222';
const DEPT = '33333333-3333-3333-3333-333333333333';
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');

const result = {
  test: 'T-M4-38',
  environment: 'local-kind-univ-a + local MinIO (축소 환경)',
  limitation: 'Object Storage 완전 단절을 짧게 재현했다. 운영 지연 시간·부하 수치가 아니다.',
  startedAt: new Date().toISOString(),
  checks: {},
};

function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'wonseoro', '-d', 'univ_a', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO kadmission,public; ${statement}`],
    { encoding: 'utf8' },
  ).trim();
}

async function request(base, method, path, { headers = {}, body, rawBody, timeoutMs = 8000 } = {}) {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: rawBody === undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON이 아닌 Object Storage 응답 */ }
    return { status: response.status, json, text, headers: response.headers };
  } catch (error) {
    return { status: 0, error: error.name === 'TimeoutError' ? 'TIMEOUT' : String(error.cause?.code ?? error.message) };
  }
}

async function waitMinio(up, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await request(MINIO, 'GET', '/minio/health/ready', { timeoutMs: 2000 });
    if (up ? response.status === 200 : response.status === 0) return Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MinIO가 ${up ? '복구' : '중단'} 상태가 되지 않았습니다`);
}

function check(name, pass, detail) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}

/** 서명된 Host는 유지하고 Windows 호스트에서만 127.0.0.1로 해석해 직접 업로드한다. */
function directUpload(signedUrl, requiredHeaders, timeoutSeconds) {
  const url = new URL(signedUrl);
  const args = [
    '-sS', '-o', 'NUL', '-w', '%{http_code}', '--max-time', String(timeoutSeconds),
    '--resolve', `${url.hostname}:${url.port || '80'}:127.0.0.1`, '-X', 'PUT',
  ];
  for (const [name, value] of Object.entries(requiredHeaders)) args.push('-H', `${name}: ${value}`);
  args.push('--data-binary', '@-', signedUrl);
  const child = spawnSync('curl.exe', args, { input: PDF, encoding: 'utf8' });
  return {
    status: Number(child.stdout) || 0,
    error: child.status === 0 ? null : (child.stderr.trim() || `curl exit ${child.status}`),
  };
}

let minioRestored = false;
try {
  const ready = await request(API, 'GET', '/readyz');
  if (ready.status !== 200) throw new Error(`UNIV-A API가 준비되지 않았습니다: ${ready.status}`);
  await waitMinio(true, 30_000);

  execFileSync('docker', ['stop', MINIO_CONTAINER], { stdio: 'inherit' });
  const detectedMs = await waitMinio(false, 30_000);
  const outageStarted = Date.now();
  check('object-storage-is-down', true, { detectedMs });

  const catalogSamples = await Promise.all(Array.from({ length: 20 }, () =>
    request(API, 'GET', '/api/v1/admission-cycles/current')));
  check('catalog-continues-during-outage', catalogSamples.every((sample) => sample.status === 200), {
    requests: catalogSamples.length,
    failures: catalogSamples.filter((sample) => sample.status !== 200).length,
  });

  const applicantId = randomUUID();
  const subjectToken = `subj-m4-38-${applicantId.slice(0, 8)}`;
  sql(`INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${applicantId}','${subjectToken}','\\x00','v1')`);
  const identity = { 'x-applicant-id': applicantId, 'x-subject-token': subjectToken };
  const created = await request(API, 'POST', '/api/v1/applications', {
    headers: { ...identity, 'idempotency-key': `m4-38-create-${randomUUID()}` },
    body: { cycleId: CYCLE, admissionTypeId: TYPE, departmentId: DEPT, consents: ['APPLICATION_COLLECTION', 'SCHOOL_RECORD_PROVISION'] },
  });
  if (created.status !== 201) throw new Error(`원서 생성 실패: ${created.status}`);
  const applicationId = created.json.id;
  const saved = await request(API, 'PATCH', `/api/v1/applications/${applicationId}`, {
    headers: {
      ...identity,
      'idempotency-key': `m4-38-save-${randomUUID()}`,
      'if-match': created.headers.get('etag'),
      'content-type': 'application/merge-patch+json',
    },
    body: {
      fields: {
        highSchool: 'Object Storage 장애 시험 고등학교',
        graduationYear: 2026,
        academicNote: '서류 저장소 장애 중에도 원서 자동저장이 지속되는지 확인합니다.',
      },
    },
  });
  const persisted = sql(`SELECT value_json #>> '{}' FROM application_field_value WHERE application_id='${applicationId}' AND field_code='highSchool'`);
  check('draft-save-continues-during-outage', saved.status === 200 && persisted === 'Object Storage 장애 시험 고등학교', {
    createStatus: created.status,
    saveStatus: saved.status,
    persisted,
  });

  const intent = await request(API, 'POST', `/api/v1/applications/${applicationId}/documents/upload-intents`, {
    headers: { ...identity, 'idempotency-key': `m4-38-upload-${randomUUID()}` },
    body: { documentType: 'TRANSCRIPT', filename: 'transcript.pdf', mediaType: 'application/pdf', sizeBytes: PDF.length },
  });
  if (intent.status !== 201) throw new Error(`업로드 의도 생성 실패: ${intent.status}`);
  const failedUpload = directUpload(intent.json.uploadUrl, intent.json.requiredHeaders, 3);
  check('only-direct-upload-fails-during-outage', failedUpload.status === 0, {
    uploadStatus: failedUpload.status,
    error: failedUpload.error ?? null,
    compressedOutageMs: Date.now() - outageStarted,
  });

  execFileSync('docker', ['start', MINIO_CONTAINER], { stdio: 'inherit' });
  const recoveredMs = await waitMinio(true, 60_000);
  minioRestored = true;

  const uploaded = directUpload(intent.json.uploadUrl, intent.json.requiredHeaders, 8);
  const completed = await request(API, 'POST', `/api/v1/documents/${intent.json.documentId}/complete`, {
    headers: { ...identity, 'idempotency-key': `m4-38-complete-${randomUUID()}` },
    body: { sha256: createHash('sha256').update(PDF).digest('hex'), sizeBytes: PDF.length },
  });
  check('upload-recovers-after-storage-returns', uploaded.status >= 200 && uploaded.status < 300 && completed.status === 202, {
    recoveredMs,
    uploadStatus: uploaded.status,
    completeStatus: completed.status,
    documentStatus: completed.json?.status ?? null,
  });

  result.applicationId = applicationId;
  result.documentId = intent.json.documentId;
  result.compressedOutageMs = Date.now() - outageStarted;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  console.error(`✖ 중단: ${result.error}`);
} finally {
  try {
    execFileSync('docker', ['start', MINIO_CONTAINER], { stdio: 'ignore' });
    await waitMinio(true, 60_000);
    minioRestored = true;
  } catch (error) {
    result.restoreError = error instanceof Error ? error.message : String(error);
  }
}

check('object-storage-restored', minioRestored, { restored: minioRestored });
result.finishedAt = new Date().toISOString();
result.passed = !result.error && !result.restoreError && Object.values(result.checks).every((item) => item.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/object-storage-outage-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '통과' : '실패'} — ${output}`);
process.exit(result.passed ? 0 : 1);
