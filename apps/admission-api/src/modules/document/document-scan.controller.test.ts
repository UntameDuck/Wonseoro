import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseScanLimit } from './document-scan.controller';

describe('검사 대기 목록 개수', () => {
  it('생략하면 50, 상한을 넘으면 200이다', () => {
    assert.equal(parseScanLimit(), 50);
    assert.equal(parseScanLimit('250'), 200);
  });

  it('숫자가 아니거나 1보다 작으면 DB에 보내지 않는다', () => {
    for (const value of ['NaN', 'http://example.com', '0', '-1', '1.5']) {
      assert.throws(() => parseScanLimit(value));
    }
  });
});
