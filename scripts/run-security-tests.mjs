import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const universityUrl = process.env.UNIVERSITY_DATABASE_URL;
const universityAdminUrl = process.env.UNIVERSITY_DATABASE_ADMIN_URL;
const centralUrl = process.env.CENTRAL_DATABASE_URL;

if (!universityUrl || !universityAdminUrl || !centralUrl) {
  console.error(
    '보안 시험에는 UNIVERSITY_DATABASE_URL, UNIVERSITY_DATABASE_ADMIN_URL, CENTRAL_DATABASE_URL이 모두 필요합니다.',
  );
  process.exit(1);
}

const groups = [
  {
    name: '공용 설정·가명화·로그 마스킹',
    files: [
      'packages/server-kit/dist/env.test.js',
      'packages/server-kit/dist/purpose-ref.test.js',
      'packages/server-kit/dist/telemetry/logger.test.js',
    ],
    env: {},
  },
  {
    name: '대학 권한·감사·결제·입력 방어',
    files: [
      'apps/admission-api/dist/common/identity/ownership-coverage.test.js',
      'apps/admission-api/dist/common/identity/ownership.integration.test.js',
      'apps/admission-api/dist/common/throttle/adaptive-throttle.test.js',
      'apps/admission-api/dist/modules/audit/audit-chain.integration.test.js',
      'apps/admission-api/dist/modules/config/two-person-rule.test.js',
      'apps/admission-api/dist/modules/document/file-inspector.test.js',
      'apps/admission-api/dist/modules/payment/payment-reconcile.integration.test.js',
    ],
    env: {
      DATABASE_URL: universityUrl,
      DATABASE_ADMIN_URL: universityAdminUrl,
      UNIVERSITY_ID: process.env.UNIVERSITY_ID ?? 'UNIV-A',
    },
  },
  {
    name: '파일 검사 엔진 실패 폐쇄',
    files: ['apps/document-service/dist/engines.test.js'],
    env: {},
  },
  {
    name: '중앙 재전송·위장 발신·개인정보 최소화',
    files: ['apps/central-api/dist/integration.test.js'],
    env: { DATABASE_URL: centralUrl },
  },
];

let total = 0;

for (const group of groups) {
  const files = group.files.map((file) => resolve(root, file));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`빌드 결과가 없습니다:\n${missing.join('\n')}`);
    process.exit(1);
  }

  console.log(`\n[보안 시험] ${group.name}`);
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '', DATABASE_ADMIN_URL: '', ...group.env },
    },
  );

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[실패] ${group.name}: 시험 프로세스 종료 코드 ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const tests = Number(result.stdout.match(/^# tests (\d+)$/m)?.[1]);
  const passed = Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]);
  const skipped = Number(result.stdout.match(/^# skipped (\d+)$/m)?.[1]);
  if (!Number.isInteger(tests) || !Number.isInteger(passed) || !Number.isInteger(skipped)) {
    console.error(`[실패] ${group.name}: TAP 요약을 읽지 못했습니다.`);
    process.exit(1);
  }
  if (skipped !== 0 || passed !== tests) {
    console.error(`[실패] ${group.name}: ${tests}개 중 통과 ${passed}, 건너뜀 ${skipped}`);
    process.exit(1);
  }

  total += tests;
  console.log(`[통과] ${group.name}: ${tests}개, 건너뜀 0`);
}

console.log(`\n보안 시험 전체 통과: ${total}개, 건너뜀 0`);
