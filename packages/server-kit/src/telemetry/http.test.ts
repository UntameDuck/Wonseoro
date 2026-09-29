import assert from 'node:assert/strict';
import test from 'node:test';
import { safeHttpMetricAttributes } from './http';

test('HTTP 지표 라벨은 메서드·라우트 템플릿·상태 코드만 남긴다', () => {
  assert.deepEqual(
    safeHttpMetricAttributes({
      method: 'POST',
      route: '/api/v1/applications/:applicationId',
      statusCode: 202,
      durationMs: 18,
    }),
    {
      'http.request.method': 'POST',
      'http.route': '/api/v1/applications/:applicationId',
      'http.response.status_code': 202,
    },
  );
});

test('원시 UUID가 섞인 경로는 지표 라벨로 내보내지 않는다', () => {
  const attributes = safeHttpMetricAttributes({
    method: 'GET',
    route: '/api/v1/applications/84f21d99-750b-4b4d-a43c-f8acb30672bd',
    statusCode: 200,
    durationMs: 1,
  });

  assert.equal(attributes['http.route'], 'unmatched');
  assert.equal(JSON.stringify(attributes).includes('84f21d99'), false);
});

test('쿼리 문자열과 비정상 메서드·상태 값은 안전한 저카디널리티 값으로 바꾼다', () => {
  assert.deepEqual(
    safeHttpMetricAttributes({
      method: 'GET applicant@example.com',
      route: '/api/v1/search?residentNumber=secret',
      statusCode: 999,
      durationMs: -10,
    }),
    {
      'http.request.method': 'UNKNOWN',
      'http.route': 'unmatched',
      'http.response.status_code': 0,
    },
  );
});
