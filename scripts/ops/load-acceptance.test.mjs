import assert from 'node:assert/strict';
import test from 'node:test';
import { validateK6Summary } from './load-acceptance.mjs';

const metric = (value = 0) => ({ values: { count: value }, thresholds: { rule: { ok: true } } });
const passing = () => ({
  metadata: { profile: 'baseline-500', environment: 'pilot-staging', approval: 'OPS-1', startedAt: '2027-01-01T00:00:00Z' },
  metrics: {
    http_req_failed: metric(),
    'http_req_duration{kind:read}': metric(),
    'http_req_duration{kind:save}': metric(),
    checks: metric(),
    dropped_iterations: metric(),
  },
});

test('필수 threshold가 모두 통과하고 버린 iteration이 없으면 통과한다', () => {
  assert.deepEqual(validateK6Summary(passing(), 'baseline-500'), { passed: true, blockers: [] });
});

test('프로필 불일치·threshold 실패·버린 iteration을 모두 보고한다', () => {
  const summary = passing();
  summary.metadata.profile = 'expected-1500';
  summary.metrics.http_req_failed.thresholds.rule.ok = false;
  summary.metrics.dropped_iterations.values.count = 7;
  const result = validateK6Summary(summary, 'baseline-500');
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers.map((item) => item.at), [
    'metadata.profile',
    'metrics.http_req_failed.thresholds',
    'metrics.dropped_iterations',
  ]);
});

test('필수 metric이나 threshold 판정이 사라지면 통과시키지 않는다', () => {
  const summary = passing();
  delete summary.metrics.checks;
  summary.metrics['http_req_duration{kind:save}'].thresholds = {};
  const paths = validateK6Summary(summary, 'baseline-500').blockers.map((item) => item.at);
  assert(paths.includes('metrics.checks'));
  assert(paths.includes('metrics.http_req_duration{kind:save}.thresholds'));
});
