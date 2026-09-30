import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { malformedIdParam } from './uuid-params';

describe('경로 식별자 형식 (형식 오류는 404, 500 이 아니다)', () => {
  it('UUID 가 아닌 …Id 경로 변수를 찾는다', () => {
    assert.equal(malformedIdParam({ applicationId: 'undefined' }), 'applicationId');
    assert.equal(malformedIdParam({ paymentId: "1' OR '1'='1" }), 'paymentId');
  });

  it('UUID·식별자가 아닌 변수는 통과시킨다', () => {
    assert.equal(malformedIdParam({ applicationId: '61ec4a28-aa43-4c53-8be4-5ec89e45fb32' }), null);
    assert.equal(malformedIdParam({ provider: 'mock-pg' }), null);
    assert.equal(malformedIdParam(undefined), null);
  });
});
