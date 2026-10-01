import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { malformedIdParam, malformedIdQuery } from './uuid-params';

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

  it('쿼리의 UUID 식별자도 DB에 보내기 전에 찾는다', () => {
    assert.equal(malformedIdQuery({ cycleId: 'cycleId' }), 'cycleId');
    assert.equal(malformedIdQuery({ admissionCycleId: 'http://example.com' }), 'admissionCycleId');
    assert.equal(malformedIdQuery({ cycleId: '11111111-1111-1111-1111-111111111111' }), null);
    assert.equal(malformedIdQuery({ limit: '50' }), null);
  });
});
