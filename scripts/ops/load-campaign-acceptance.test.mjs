import assert from 'node:assert/strict';
import test from 'node:test';
import { PROFILE_SPECS, RESOURCE_TRENDS, validateLoadCampaign } from './load-campaign-acceptance.mjs';

const evidence = ['ticket://LOAD-1'];
const document = () => ({
  metadata: { universityId: 'UNIV-A', environmentId: 'pilot-load-a', environmentType: 'csp-load-staging', approval: 'LOAD-APPROVAL-1', approvedAt: '2027-01-01T09:00:00+09:00', executedBy: '성능시험 책임자', evidence },
  results: Object.keys(PROFILE_SPECS).map((id) => ({ id, file: `tests/load/results/${id}.json` })),
  resourceTrends: RESOURCE_TRENDS.map((id) => ({ id, verdict: 'within-capacity', observed: '증가 뒤 안정화·승인 상한 이내', approvedBy: '용량 책임자', evidence })),
  finalDecision: { status: 'approved', approvedAt: '2027-01-03T09:00:00+09:00', approvedBy: '시험 총괄', evidence },
});
const results = () => Object.fromEntries(Object.entries(PROFILE_SPECS).map(([id, spec]) => [id, {
  profile: id, passed: true, blockers: [],
  execution: { environment: 'pilot-load-a', approval: 'LOAD-APPROVAL-1', durationMs: spec.minDurationMs },
  testSet: { users: spec.users ?? 100 },
  database: { checks: id === 'failover-70' ? [{ id: 'writerEpoch', passed: true }] : [] },
}]));

test('다섯 프로필과 자원 추세·승인이 모두 있으면 통과한다', () => {
  const result = validateLoadCampaign(document(), results());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { profiles: '5/5', resourceTrends: '5/5' });
});

test('환경·승인이 다른 결과와 짧은 Soak를 차단한다', () => {
  const rows = results();
  rows['baseline-500'].execution.environment = 'other';
  rows['expected-1500'].execution.approval = 'OTHER';
  rows['soak-6h'].execution.durationMs -= 1;
  const paths = validateLoadCampaign(document(), rows).blockers.map((item) => item.at);
  assert(paths.includes('results.baseline-500.environment'));
  assert(paths.includes('results.expected-1500.approval'));
  assert(paths.includes('results.soak-6h.durationMs'));
});

test('누락 결과·Failover 세대·자원 용량 초과·미승인을 차단한다', () => {
  const doc = document();
  const rows = results();
  delete rows['deadline-3000-rps1000'];
  rows['failover-70'].database.checks = [];
  doc.resourceTrends[0].verdict = 'exceeded';
  doc.finalDecision.status = 'pending';
  const paths = validateLoadCampaign(doc, rows).blockers.map((item) => item.at);
  assert(paths.includes('results.deadline-3000-rps1000.file'));
  assert(paths.includes('results.failover-70.writerEpoch'));
  assert(paths.includes('resourceTrends.api-memory.verdict'));
  assert(paths.includes('finalDecision.status'));
});
