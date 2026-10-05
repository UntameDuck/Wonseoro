import assert from 'node:assert/strict';
import test from 'node:test';
import { pageOf, parseRegister, renderChangeset, replaceGeneratedAppendix } from './notion-changeset.mjs';

const open = `## D-1. 첫 항목
| **상태** | 🟡 저장소 반영, 노션 반영 대기 |
| **노션 반영** | ⬜ §02 DDL 반영 · §03 OpenAPI 교체 (CloudEvents 는 바뀌지 않았다) |
| **PDF 반영** | ⬜ 정오표 반영 |
`;
const closed = `## D-2. 끝난 항목
| **상태** | 🟢 CLOSED |
| **노션 반영** | ⬜ §06 반영 |
`;

test('열린 대장 항목만 읽는다', () => {
  assert.deepEqual(parseRegister(`${open}\n${closed}`), [{
    id: 'D-1',
    title: '첫 항목',
    status: '🟡 저장소 반영, 노션 반영 대기',
    notion: ['§02 DDL 반영 · §03 OpenAPI 교체 (CloudEvents 는 바뀌지 않았다)'],
    pdf: ['정오표 반영'],
  }]);
});

test('바뀌지 않은 문서는 반영 대상으로 분류하지 않는다', () => {
  assert.deepEqual(pageOf('§02 DDL 반영 (OpenAPI·CloudEvents 는 바뀌지 않았다)'), ['§02 ERD·DDL']);
  assert.deepEqual(pageOf('§19 운영 런북 반영'), ['§19 운영 런북']);
});

test('대장 항목을 문서별 목록으로 만든다', () => {
  const output = renderChangeset(open);
  assert.match(output, /1건에서 3개 수정 지점/);
  assert.match(output, /### §02 ERD·DDL — 1건/);
  assert.match(output, /### §03 OpenAPI — 1건/);
  assert.match(output, /### 제출 PDF 정정 — 1건/);
});

test('표시 사이만 바꾸고 원래 줄바꿈을 보존한다', () => {
  const document = `앞\r\n<!-- 자동 생성: 옛 목록 -->\r\n<!-- items=1 edits=1 -->\r\n뒤\r\n`;
  assert.equal(
    replaceGeneratedAppendix(document, '<!-- 자동 생성: 새 목록 -->\n<!-- items=2 edits=3 -->'),
    `앞\r\n<!-- 자동 생성: 새 목록 -->\r\n<!-- items=2 edits=3 -->\r\n뒤\r\n`,
  );
});
