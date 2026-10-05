import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertAttachmentFacts, parseAttachmentRows } from './check-notion-assets.mjs';

test('첨부 교체표에서 경로·버전·바이트·해시를 읽는다', () => {
  const hash = 'a'.repeat(64);
  const markdown = `| 문서 | 첨부 | 저장소 파일 | 바이트 | SHA-256 | 근거 |\n|---|---|---|---|---|---|\n| §03 | x | \`a/b.yaml\` (v1.2.3) | 1,234 | \`${hash}\` | D-1 |`;
  assert.deepEqual(parseAttachmentRows(markdown), [
    { path: 'a/b.yaml', version: '1.2.3', bytes: 1234, sha256: hash },
  ]);
});

test('바이트와 해시가 같으면 통과한다', () => {
  const content = Buffer.from('원서로', 'utf8');
  assert.doesNotThrow(() => assertAttachmentFacts({
    path: 'asset',
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }, content));
});

test('바이트 또는 해시가 다르면 실패한다', () => {
  const content = Buffer.from('asset');
  assert.throws(
    () => assertAttachmentFacts({ path: 'asset', bytes: content.length + 1, sha256: '0'.repeat(64) }, content),
    /바이트가 문서/,
  );
  assert.throws(
    () => assertAttachmentFacts({ path: 'asset', bytes: content.length, sha256: '0'.repeat(64) }, content),
    /SHA-256이 문서/,
  );
});
