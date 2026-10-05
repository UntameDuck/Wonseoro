// 노션 첨부 교체 대기표(문서 06)의 바이트·SHA-256이 저장소 파일과 어긋나지 않게 한다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');

export function parseAttachmentRows(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const columns = line.slice(1, -1).split('|').map((column) => column.trim());
    if (columns.length < 5) continue;
    const pathMatch = columns[2]?.match(/`([^`]+)`/);
    const hashMatch = columns[4]?.match(/`([a-f0-9]{64})`/);
    const bytes = Number(columns[3]?.replaceAll(',', ''));
    if (!pathMatch || !hashMatch || !Number.isSafeInteger(bytes)) continue;
    rows.push({
      path: pathMatch[1],
      bytes,
      sha256: hashMatch[1],
      version: columns[2].match(/\(v([0-9]+(?:\.[0-9]+)+)/)?.[1],
    });
  }
  return rows;
}

export function assertAttachmentFacts({ path, bytes, sha256 }, content) {
  if (content.length !== bytes) {
    throw new Error(`${path}: 바이트가 문서 ${bytes} / 실제 ${content.length}로 다릅니다`);
  }
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== sha256) {
    throw new Error(`${path}: SHA-256이 문서 ${sha256} / 실제 ${actualHash}로 다릅니다`);
  }
}

function main() {
  const changeset = readFileSync(resolve(root, 'docs/06-notion-changeset.md'), 'utf8');
  const rows = parseAttachmentRows(changeset);
  if (rows.length !== 5) {
    throw new Error(`docs/06-notion-changeset.md: 첨부 교체 행을 5개 찾아야 하지만 ${rows.length}개입니다`);
  }

  for (const row of rows) {
    const content = readFileSync(resolve(root, row.path));
    assertAttachmentFacts(row, content);

    if (row.path === 'packages/contracts/openapi/k-admission.v1.yaml') {
      const actualVersion = content.toString('utf8').match(/^ {2}version:\s*['"]?([^'"\s#]+)/m)?.[1];
      if (!actualVersion || actualVersion !== row.version) {
        throw new Error(`${row.path}: 버전이 문서 ${row.version ?? '없음'} / 실제 ${actualVersion ?? '없음'}으로 다릅니다`);
      }
    }
    console.log(`✔ ${row.path} — ${row.bytes.toLocaleString('en-US')}바이트, SHA-256 일치`);
  }
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
