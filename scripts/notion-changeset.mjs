// 설계 불일치 대장의 미반영 항목을 문서 05의 노션 변경 목록으로 만든다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const registerPath = resolve(root, 'docs/02-spec-discrepancy-register.md');
const readinessPath = resolve(root, 'docs/05-m3-exit-m4-readiness.md');

const pages = [
  ['§01 운영 리스크', /§01|§A\d|§B\d|§C\d|§E\b|C8|A1\b|A12|A14|A15|B17/],
  ['§02 ERD·DDL', /§02|DDL|ERD/],
  ['§03 OpenAPI', /§03|OpenAPI|계약|조회 경로/],
  ['§06 보안정책', /§06/],
  ['§04 CloudEvents', /§04/],
  ['§05 배포 구성', /§05/],
  ['§07 KRDS', /§07/],
  ['§08 성능', /§08|M Profile/],
  ['§09 STRIDE', /§09/],
  ['§19 운영 런북', /§19/],
  ['v1.0 본문', /v1\.0|§(?!19\b)[1-9]\d?(?:\.\d+)?(?!\d)/],
];

const order = ['먼저 결정·확인이 필요한 것', ...pages.map(([name]) => name), '제출 PDF 정정', '기타'];

export function pageOf(text) {
  const target = text.replace(/\([^)]*바뀌지 않았다[^)]*\)/g, '');
  const hits = pages.filter(([, pattern]) => pattern.test(target)).map(([name]) => name);
  return hits.length > 0 ? hits : ['기타'];
}

export function parseRegister(markdown) {
  const source = markdown.replaceAll('\r\n', '\n').split('<!--', 1)[0];
  const items = [];
  for (const block of source.split(/\n(?=## D-\d+\. )/)) {
    const heading = block.match(/^## (D-\d+)\. (.+)/);
    if (!heading) continue;
    const status = block.match(/\| \*\*상태\*\* \| (.+?) \|/)?.[1]?.trim() ?? '';
    if (status.includes('CLOSED')) continue;
    items.push({
      id: heading[1],
      title: heading[2].trim(),
      status,
      notion: [...block.matchAll(/\| \*\*노션 반영\*\* \| ⬜ (.+?) \|\n/g)].map((match) => match[1]),
      pdf: [...block.matchAll(/\| \*\*PDF 반영\*\* \| ⬜ (.+?) \|\n/g)].map((match) => match[1]),
    });
  }
  return items;
}

function add(grouped, group, line) {
  const lines = grouped.get(group) ?? [];
  lines.push(line);
  grouped.set(group, lines);
}

export function renderChangeset(markdown) {
  const items = parseRegister(markdown);
  const grouped = new Map();

  for (const item of items) {
    for (const todo of item.notion) {
      for (const part of todo.split(' · ').map((value) => value.trim()).filter(Boolean)) {
        if (part.startsWith('✅')) continue;
        const line = `- **${item.id}** ${part}<br>\n  <sub>${item.title}</sub>`;
        if (part.includes('결정') || part.includes('확인')) {
          add(grouped, '먼저 결정·확인이 필요한 것', line);
          continue;
        }
        for (const page of pageOf(part)) add(grouped, page, line);
      }
    }
    for (const pdf of item.pdf) add(grouped, '제출 PDF 정정', `- **${item.id}** ${pdf}`);

    const decisions = grouped.get('먼저 결정·확인이 필요한 것') ?? [];
    if (item.status.includes('확인') && !decisions.some((line) => line.includes(`**${item.id}**`))) {
      add(grouped, '먼저 결정·확인이 필요한 것', `- **${item.id}** ${item.status}<br>\n  <sub>${item.title}</sub>`);
    }
  }

  const edits = [...grouped.values()].reduce((sum, lines) => sum + lines.length, 0);
  const output = [`<!-- 자동 생성: 불일치 대장의 "노션 반영 ⬜" 항목 ${items.length}건에서 ${edits}개 수정 지점 -->`];
  for (const group of order) {
    const lines = grouped.get(group);
    if (!lines) continue;
    output.push('', `### ${group} — ${lines.length}건`, '', ...lines);
  }
  output.push('', `<!-- items=${items.length} edits=${edits} -->`);
  return output.join('\n');
}

export function replaceGeneratedAppendix(document, generated) {
  const start = document.indexOf('<!-- 자동 생성:');
  const endMarker = document.indexOf('<!-- items=', start);
  const end = document.indexOf('-->', endMarker) + 3;
  if (start < 0 || endMarker < 0 || end < 3) throw new Error('문서 05에서 자동 생성 부록 표시를 찾지 못했습니다');
  const newline = document.includes('\r\n') ? '\r\n' : '\n';
  return document.slice(0, start) + generated.replaceAll('\n', newline) + document.slice(end);
}

function main() {
  const generated = renderChangeset(readFileSync(registerPath, 'utf8'));
  const document = readFileSync(readinessPath, 'utf8');
  const next = replaceGeneratedAppendix(document, generated);

  if (process.argv.includes('--write')) {
    writeFileSync(readinessPath, next, 'utf8');
    const { length: items } = parseRegister(readFileSync(registerPath, 'utf8'));
    const edits = Number(generated.match(/edits=(\d+)/)?.[1]);
    console.log(`✔ 문서 05 부록 갱신: ${items}건 · ${edits}개 수정 지점`);
    return;
  }
  if (process.argv.includes('--check')) {
    if (document !== next) throw new Error('문서 05의 노션 반영 목록이 대장과 다릅니다. npm run docs:notion-changeset을 실행하세요');
    console.log('✔ 노션 변경 목록 드리프트 없음');
    return;
  }
  process.stdout.write(`${generated}\n`);
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
