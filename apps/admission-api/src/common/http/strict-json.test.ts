import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProblemException } from '../problem/problem.exception';
import { strictJsonParser } from './strict-json';

function parse(body: Buffer): { err: Error | null; value?: unknown } {
  let out: { err: Error | null; value?: unknown } = { err: null };
  strictJsonParser(null, body, (err, value) => {
    out = { err, value };
  });
  return out;
}

describe('JSON 본문 파서 (D-37)', () => {
  it('UTF-8 한글은 그대로 받는다', () => {
    const r = parse(Buffer.from(JSON.stringify({ decisionRef: '입학처-2026-117' }), 'utf8'));
    assert.equal(r.err, null);
    assert.deepEqual(r.value, { decisionRef: '입학처-2026-117' });
  });

  it('CP949 로 보낸 한글은 � 로 바꿔 받지 않고 400 으로 거절한다', () => {
    // "입학" 의 CP949 바이트. 기본 파서는 이것을 �� 로 저장하고 성공이라 답했다.
    const body = Buffer.concat([
      Buffer.from('{"decisionRef":"'),
      Buffer.from([0xc0, 0xd4, 0xc7, 0xd0]),
      Buffer.from('"}'),
    ]);
    const r = parse(body);
    assert.ok(r.err instanceof ProblemException);
    assert.equal((r.err as ProblemException).getStatus(), 400);
  });

  it('잘못된 JSON 은 400 이다 — 서버 고장(500)으로 보이면 같은 요청을 또 보낸다', () => {
    const r = parse(Buffer.from('{bad'));
    assert.ok(r.err instanceof ProblemException);
    assert.equal((r.err as ProblemException).getStatus(), 400);
  });

  it('빈 본문은 빈 객체다', () => {
    assert.deepEqual(parse(Buffer.alloc(0)).value, {});
  });
});
