// k6 외부 부하 시험 뒤 성능 threshold + 대학 DB 업무 정합성을 함께 판정한다.
// k6가 성공해도 DB 대조가 없으면 T-M4-30~32·36·41 증적으로 받지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPECTED_THRESHOLDS = [
  'http_req_failed',
  'http_req_duration{kind:read}',
  'http_req_duration{kind:save}',
  'checks',
  'dropped_iterations',
];

export function validateK6Summary(summary, expectedProfile) {
  const blockers = [];
  if (summary?.metadata?.profile !== expectedProfile) {
    blockers.push({ at: 'metadata.profile', message: `요청 프로필 ${expectedProfile}과 결과 ${summary?.metadata?.profile ?? '(없음)'}가 다르다` });
  }
  for (const field of ['environment', 'approval', 'startedAt']) {
    if (typeof summary?.metadata?.[field] !== 'string' || summary.metadata[field].trim() === '') {
      blockers.push({ at: `metadata.${field}`, message: '실행 메타데이터가 없다' });
    }
  }
  for (const name of EXPECTED_THRESHOLDS) {
    const metric = summary?.metrics?.[name];
    if (!metric) {
      blockers.push({ at: `metrics.${name}`, message: '필수 metric이 없다' });
      continue;
    }
    const thresholdRows = metric.thresholds && typeof metric.thresholds === 'object' ? Object.values(metric.thresholds) : [];
    if (thresholdRows.length === 0) blockers.push({ at: `metrics.${name}.thresholds`, message: 'threshold 판정이 없다' });
    if (thresholdRows.some((row) => row?.ok !== true)) blockers.push({ at: `metrics.${name}.thresholds`, message: 'threshold를 통과하지 못했다' });
  }
  const dropped = Number(summary?.metrics?.dropped_iterations?.values?.count ?? 0);
  if (dropped !== 0) blockers.push({ at: 'metrics.dropped_iterations', message: `버린 iteration ${dropped}개` });
  return { passed: blockers.length === 0, blockers };
}

const QUERIES = [
  ['duplicateSubmission', `SELECT count(*)::int AS count FROM (SELECT s.application_id FROM submission s WHERE s.application_id = ANY($1::uuid[]) GROUP BY s.application_id HAVING count(*) > 1) q`],
  ['paymentDoubleConfirm', `SELECT count(*)::int AS count FROM (SELECT p.application_id FROM payment p WHERE p.application_id = ANY($1::uuid[]) AND p.status='CONFIRMED' GROUP BY p.application_id HAVING count(*) > 1) q`],
  ['finalizedWithoutSubmission', `SELECT count(*)::int AS count FROM application a WHERE a.id = ANY($1::uuid[]) AND a.status='FINALIZED' AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.application_id=a.id)`],
  ['submissionWithoutConfirmedPayment', `SELECT count(*)::int AS count FROM submission s WHERE s.application_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.application_id=s.application_id AND p.status='CONFIRMED')`],
  ['duplicateOutboxSequence', `SELECT count(*)::int AS count FROM (SELECT o.aggregate_id,o.aggregate_sequence FROM outbox_event o WHERE o.aggregate_id = ANY($1::uuid[]) GROUP BY o.aggregate_id,o.aggregate_sequence HAVING count(*) > 1) q`],
  ['deadOutbox', `SELECT count(*)::int AS count FROM outbox_event o WHERE o.aggregate_id = ANY($1::uuid[]) AND o.status='DEAD'`],
  ['openReconciliationException', `SELECT count(*)::int AS count FROM reconciliation_exception r WHERE r.application_id = ANY($1::uuid[]) AND r.state IN ('OPEN','MANUAL_REVIEW')`],
];

async function verifyDatabase(connectionString, applicationIds, expectedWriterEpoch) {
  const client = new pg.Client({ connectionString, application_name: 'wonseoro-load-acceptance', statement_timeout: 30_000 });
  const checks = [];
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL search_path TO kadmission, public`);
    for (const [id, sql] of QUERIES) {
      const count = Number((await client.query(sql, [applicationIds])).rows[0].count);
      checks.push({ id, passed: count === 0, count });
    }
    const volume = (await client.query(
      `SELECT count(*)::int AS applications,
              count(*) FILTER (WHERE status='FINALIZED')::int AS finalized
         FROM application WHERE id = ANY($1::uuid[])`,
      [applicationIds],
    )).rows[0];
    const fence = (await client.query(`SELECT epoch,require_token,promoted_at,promoted_by FROM writer_fence WHERE singleton`)).rows[0];
    if (expectedWriterEpoch !== null) {
      checks.push({ id: 'writerEpoch', passed: Number(fence?.epoch) === expectedWriterEpoch, expected: expectedWriterEpoch, actual: Number(fence?.epoch) });
    }
    await client.query('COMMIT');
    return { passed: checks.every((item) => item.passed), checks, volume, writerFence: fence ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function cli() {
  const value = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const summaryArg = value('summary');
  const usersArg = value('users');
  const profile = value('profile');
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!summaryArg || !usersArg || !profile || !connectionString) {
    console.error('사용: DATABASE_ADMIN_URL=... node scripts/ops/load-acceptance.mjs --summary=<k6.json> --users=<합성사용자.json> --profile=<프로필> [--expected-writer-epoch=N]');
    process.exit(2);
  }
  const epochArg = value('expected-writer-epoch');
  const expectedWriterEpoch = epochArg === undefined ? null : Number(epochArg);
  if (profile === 'failover-70' && (!Number.isInteger(expectedWriterEpoch) || expectedWriterEpoch < 2)) {
    throw new Error('failover-70은 --expected-writer-epoch=2 이상의 실제 승격 세대가 필요하다.');
  }
  const summaryPath = path.resolve(ROOT, summaryArg);
  const usersPath = path.resolve(ROOT, usersArg);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const userRows = JSON.parse(readFileSync(usersPath, 'utf8'));
  if (!Array.isArray(userRows) || userRows.length === 0 || userRows.some((row) => !row?.applicationId)) {
    throw new Error('--users 파일에는 applicationId가 있는 합성 사용자 배열이 필요하다.');
  }
  const testedUsers = Number(summary?.metadata?.users);
  if (!Number.isInteger(testedUsers) || testedUsers < 1 || userRows.length < testedUsers) {
    throw new Error(`k6 결과가 요구한 합성 사용자 ${testedUsers}명을 --users 파일에서 찾을 수 없다.`);
  }
  const applicationIds = [...new Set(userRows.slice(0, testedUsers).map((row) => row.applicationId))];
  if (applicationIds.length !== testedUsers) throw new Error('시험에 쓴 구간에 중복 applicationId가 있다.');
  const k6 = validateK6Summary(summary, profile);
  const database = await verifyDatabase(connectionString, applicationIds, expectedWriterEpoch);
  const blockers = [
    ...k6.blockers,
    ...database.checks.filter((item) => !item.passed).map((item) => ({ at: `database.${item.id}`, message: `기대 0/일치, 실제 ${item.count ?? item.actual}` })),
  ];
  const result = {
    test: 'M4 외부 부하·정합성 인수 게이트',
    at: new Date().toISOString(),
    profile,
    execution: {
      environment: summary?.metadata?.environment ?? null,
      approval: summary?.metadata?.approval ?? null,
      startedAt: summary?.metadata?.startedAt ?? null,
      durationMs: Number.isFinite(Number(summary?.state?.testRunDurationMs)) ? Number(summary.state.testRunDurationMs) : null,
      users: testedUsers,
    },
    sourceSummary: path.relative(ROOT, summaryPath).replaceAll('\\', '/'),
    testSet: { users: applicationIds.length, applicationIdSetSha256: createHash('sha256').update([...applicationIds].sort().join('\n')).digest('hex') },
    passed: blockers.length === 0,
    blockers,
    k6,
    database,
  };
  console.log(`${result.passed ? '✔' : '✘'} ${profile} — k6 ${k6.passed ? '통과' : '실패'}, DB ${database.passed ? '통과' : '실패'}, 원서 ${database.volume.applications}, 접수 ${database.volume.finalized}`);
  for (const blocker of blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/load/results');
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `load-acceptance-${profile}-${result.at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
