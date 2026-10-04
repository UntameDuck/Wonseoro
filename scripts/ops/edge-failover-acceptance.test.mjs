import assert from 'node:assert/strict';
import test from 'node:test';
import { SCENARIOS, validateEdgeFailoverAcceptance } from './edge-failover-acceptance.mjs';

const evidence = ['ticket://EDGE-1'];
const complete = () => ({
  metadata: {
    universityId: 'UNIV-A', environmentId: 'pilot-staging-a', environmentType: 'csp-staging', csp: 'contracted-csp',
    gatewayClass: 'managed-gateway', deploymentRef: 'deploy://0123456', executedAt: '2027-01-02T03:04:05+09:00',
    zones: ['zone-a', 'zone-b'], evidence,
  },
  approval: { status: 'approved', approvedAt: '2027-01-01T09:00:00+09:00', scope: '계획 정비와 워커 노드 강제 종료', evidence },
  retryPolicy: {
    safeMethods: ['GET', 'HEAD', 'OPTIONS'], idempotentWriteRequiresKey: true, retryUnsafeWrites: false,
    maxAttempts: 3, perTryTimeoutMs: 2000, retryOn: ['connect-failure', 'reset', 'unavailable'], evidence,
  },
  healthCheck: { active: true, intervalSeconds: 5, unhealthyThreshold: 2, evidence },
  scenarios: SCENARIOS.map((id) => ({
    id, status: 'passed', skipped: 0, requests: 1000, firstAttemptFailures: id === 'hard-node-loss' ? 12 : 0,
    edgeRetriedRequests: id === 'hard-node-loss' ? 12 : 0, userVisibleFailures: 0, duplicateWrites: 0,
    observedRecoverySeconds: id === 'hard-node-loss' ? 18 : 3, targetRecoverySeconds: 30,
    startedAt: '2027-01-02T03:04:05+09:00', endedAt: '2027-01-02T03:10:05+09:00', evidence,
  })),
  integrity: { duplicateSubmissions: 0, doubleConfirmedPayments: 0, unrecoveredSequenceGaps: 0, checkedAt: '2027-01-02T04:00:00+09:00', evidence },
});

test('실제 다중 zone Edge가 장애를 재시도하고 정합성이 유지되면 통과한다', () => {
  const result = validateEdgeFailoverAcceptance(complete());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { scenarios: '2/2', requests: 2000, edgeRetries: 12, userVisibleFailures: 0, skipped: 0 });
});

test('로컬 환경과 멱등성 없는 쓰기 재시도를 차단한다', () => {
  const doc = complete();
  doc.metadata.environmentId = 'local-kind';
  doc.metadata.csp = 'Docker Desktop';
  doc.retryPolicy.idempotentWriteRequiresKey = false;
  doc.retryPolicy.retryUnsafeWrites = true;
  const paths = validateEdgeFailoverAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('metadata.environmentId'));
  assert(paths.includes('retryPolicy.idempotentWriteRequiresKey'));
  assert(paths.includes('retryPolicy.retryUnsafeWrites'));
});

test('관찰된 재시도 없음·사용자 실패·목표 초과·중복 접수를 차단한다', () => {
  const doc = complete();
  const hard = doc.scenarios.find((row) => row.id === 'hard-node-loss');
  hard.edgeRetriedRequests = 0;
  hard.userVisibleFailures = 1;
  hard.observedRecoverySeconds = 31;
  doc.integrity.duplicateSubmissions = 1;
  const paths = validateEdgeFailoverAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('scenarios.hard-node-loss.edgeRetriedRequests'));
  assert(paths.includes('scenarios.hard-node-loss.userVisibleFailures'));
  assert(paths.includes('scenarios.hard-node-loss.observedRecoverySeconds'));
  assert(paths.includes('integrity.duplicateSubmissions'));
});
