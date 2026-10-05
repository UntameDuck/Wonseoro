// 새 DB 마이그레이션이 로컬·CI·보안·화면 준비 경로 중 일부에서 빠지지 않게 한다.
// 파일 이름 목록은 디렉터리에서 읽으므로 다음 마이그레이션을 추가하면 이 검사가 자동으로 요구한다.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function migrationNames(relativeDir) {
  const names = readdirSync(resolve(root, relativeDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  const numbers = names.map((name) => Number(name.slice(0, 4)));
  for (const [index, number] of numbers.entries()) {
    if (number !== index + 1) {
      throw new Error(`${relativeDir}: 마이그레이션 번호가 0001부터 빈틈없이 이어지지 않습니다 (${names.join(', ')})`);
    }
  }
  return names;
}

function occurrenceIndexes(text, needle) {
  const indexes = [];
  let from = 0;
  while (true) {
    const index = text.indexOf(needle, from);
    if (index < 0) return indexes;
    indexes.push(index);
    from = index + needle.length;
  }
}

export function assertMigrationSequence({ label, text, expectedPaths, runs = 1 }) {
  const positions = expectedPaths.map((path) => occurrenceIndexes(text, path));
  const missing = expectedPaths.filter((_, index) => positions[index].length < runs);
  if (missing.length > 0) {
    throw new Error(`${label}: 빠진 마이그레이션 ${missing.join(', ')}`);
  }

  for (let run = 0; run < runs; run += 1) {
    for (let index = 1; index < expectedPaths.length; index += 1) {
      if (positions[index - 1][run] >= positions[index][run]) {
        throw new Error(`${label}: ${run + 1}번째 적용 순서가 뒤섞였습니다 (${expectedPaths[index - 1]} → ${expectedPaths[index]})`);
      }
    }
  }
}

function main() {
  const packageJson = JSON.parse(read('package.json'));
  const university = migrationNames('infra/db/migrations');
  const central = migrationNames('infra/db/central');

  const universityTargets = [
    {
      label: 'package.json db:migrate',
      text: packageJson.scripts['db:migrate'],
      prefix: 'infra/db/migrations/',
    },
    { label: 'CI 통합 잡', text: read('.github/workflows/ci.yml'), prefix: 'infra/db/migrations/' },
    {
      label: '보안 워크플로 DB 준비 두 곳',
      text: read('.github/workflows/security.yml'),
      prefix: 'infra/db/migrations/',
      runs: 2,
    },
    { label: '복구 검증 워크플로', text: read('.github/workflows/restore-verify.yml'), prefix: 'migrations/' },
    { label: '화면 시험 DB 준비', text: read('scripts/screenshots/prepare.sh'), prefix: 'migrations/' },
    { label: '로컬 DAST DB 준비', text: read('scripts/security/dast-local.mjs'), prefix: 'migrations/' },
    { label: '두 번째 대학 로컬 준비', text: read('deploy/local/README.md'), prefix: 'infra/db/migrations/' },
  ];

  for (const target of universityTargets) {
    assertMigrationSequence({
      ...target,
      expectedPaths: university.map((name) => `${target.prefix}${name}`),
    });
  }

  const screenshotCentralLine = read('scripts/screenshots/prepare.sh')
    .split(/\r?\n/)
    .find((line) => line.includes('for f in') && line.includes('-d central'));
  if (!screenshotCentralLine) throw new Error('화면 시험 DB 준비: 중앙 마이그레이션 적용 줄을 찾지 못했습니다');

  const centralTargets = [
    {
      label: 'package.json db:migrate:central',
      text: packageJson.scripts['db:migrate:central'],
      prefix: 'infra/db/central/',
    },
    { label: 'CI 중앙 통합 잡', text: read('.github/workflows/ci.yml'), prefix: 'infra/db/central/' },
    { label: '보안 워크플로 중앙 DB 준비', text: read('.github/workflows/security.yml'), prefix: 'infra/db/central/' },
    { label: '화면 시험 중앙 DB 준비', text: screenshotCentralLine, prefix: '' },
  ];

  for (const target of centralTargets) {
    assertMigrationSequence({
      ...target,
      expectedPaths: central.map((name) => `${target.prefix}${name}`),
    });
  }

  console.log(`✔ 대학 마이그레이션 ${university.length}개 × 실행 경로 ${universityTargets.length}곳`);
  console.log(`✔ 중앙 마이그레이션 ${central.length}개 × 실행 경로 ${centralTargets.length}곳`);
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
