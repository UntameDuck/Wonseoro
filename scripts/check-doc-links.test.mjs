import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { extractLocalTargets, findBrokenLinks, githubSlug, markdownAnchors, markdownFiles } from './check-doc-links.mjs';

test('외부 주소를 빼고 로컬 파일과 문서 안 앵커를 읽는다', () => {
  const markdown = '[문서](docs/a.md) ![그림](<docs/my image.png>) [절](#제목) [웹](https://example.com)';
  assert.deepEqual(extractLocalTargets(markdown), ['docs/a.md', 'docs/my image.png', '#제목']);
});

test('한글·코드 제목과 중복 제목을 GitHub식 앵커로 만든다', () => {
  assert.equal(githubSlug('§7 흉내·미연결 `전수 점검` (2026-09-30)'), '7-흉내미연결-전수-점검-2026-09-30');
  assert.equal(githubSlug('제목 — 설명 🔴'), '제목--설명-');
  assert.deepEqual([...markdownAnchors('# 제목\n## 제목\n<a id="직접"></a>')], ['제목', '제목-1', '직접']);
});

test('존재하는 상대 링크와 URL 인코딩 경로는 통과한다', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wonseoro-doc-links-'));
  mkdirSync(resolve(root, 'docs'));
  writeFileSync(resolve(root, 'README.md'), '[문서](docs/a.md)');
  writeFileSync(resolve(root, 'docs/a.md'), '# 부분\n[그림](my%20image.png)');
  writeFileSync(resolve(root, 'docs/my image.png'), 'image');
  assert.deepEqual(findBrokenLinks(root), []);
});

test('없는 제목 앵커를 보고한다', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wonseoro-doc-links-'));
  writeFileSync(resolve(root, 'README.md'), '# 있는 제목\n[정상](#있는-제목) [오류](#없는-제목)');
  assert.deepEqual(
    findBrokenLinks(root).map(({ target, reason }) => ({ target, reason })),
    [{ target: '#없는-제목', reason: '제목 앵커 없음' }],
  );
});

test('없는 대상과 저장소 밖 링크를 보고한다', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wonseoro-doc-links-'));
  writeFileSync(resolve(root, 'README.md'), '[없음](missing.md) [밖](../outside.md)');
  assert.deepEqual(
    findBrokenLinks(root).map(({ target, reason }) => ({ target, reason })),
    [
      { target: 'missing.md', reason: '대상 없음' },
      { target: '../outside.md', reason: '저장소 밖 경로' },
    ],
  );
});

test('생성물과 의존성 폴더는 Markdown 목록에서 제외한다', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wonseoro-doc-links-'));
  mkdirSync(resolve(root, 'node_modules'));
  mkdirSync(resolve(root, 'docs'));
  writeFileSync(resolve(root, 'README.md'), 'root');
  writeFileSync(resolve(root, 'node_modules/README.md'), 'dependency');
  writeFileSync(resolve(root, 'docs/a.md'), 'doc');
  assert.deepEqual(markdownFiles(root).map((file) => file.slice(root.length + 1).replaceAll('\\', '/')), ['docs/a.md', 'README.md']);
});
