import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDrAcceptance } from './dr-acceptance.mjs';

const evidence = ['ticket://DR-1'];
const complete = () => ({
  metadata: {
    universityId: 'UNIV-A', environmentId: 'pilot-dr-a', environmentType: 'csp-dr-staging', csp: 'contracted-csp',
    deploymentRef: 'deploy://0123456', primaryZone: 'zone-a', standbyZone: 'zone-b', backupFailureDomain: 'region-b', evidence,
  },
  approval: { status: 'approved', approvedAt: '2027-01-01T09:00:00+09:00', scope: 'PITR·Failover·Failback', evidence },
  preflight: { passed: true, automaticChecks: '13/13', skipped: 0, evidence },
  backup: {
    baseBackupOffsite: true, walArchiveOffsite: true, encrypted: true,
    targetRecoveryAt: '2027-01-02T03:00:00.000Z', actualRecoveryAt: '2027-01-02T03:00:00.000Z',
    restoreVerificationPassed: true, restoreVerificationSkipped: 0, evidence,
  },
  failover: {
    status: 'passed', skipped: 0, loadRunning: true, failureAt: '2027-01-02T03:10:00.000Z',
    serviceRecoveredAt: '2027-01-02T03:17:30.000Z', recoveredThroughAt: '2027-01-02T03:09:30.000Z',
    oldWriterEpoch: 7, newWriterEpoch: 8, oldWriterRejected: true, dnsOrEdgeSwitched: true, evidence,
  },
  failback: { status: 'completed', rebuiltFromCurrentWriter: true, skipped: 0, completedAt: '2027-01-02T04:00:00.000Z', evidence },
  integrity: {
    lostCommittedTransactions: 0, duplicateSubmissions: 0, doubleConfirmedPayments: 0,
    unrecoveredSequenceGaps: 0, openReconciliationExceptions: 0, checkedAt: '2027-01-02T04:10:00.000Z', evidence,
  },
});

test('원격 PITR와 RTO 15분·RPO 1분 이내 DR·Failback이 모두 있으면 통과한다', () => {
  const result = validateDrAcceptance(complete());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { automaticChecks: '13/13', rtoSeconds: 450, rpoSeconds: 30, oldWriterEpoch: 7, newWriterEpoch: 8, skipped: 0 });
});

test('같은 장애영역 백업과 로컬 환경을 차단한다', () => {
  const doc = complete();
  doc.metadata.environmentId = 'local-kind';
  doc.metadata.csp = 'Docker Desktop';
  doc.metadata.backupFailureDomain = 'zone-a';
  const paths = validateDrAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('metadata.environmentId'));
  assert(paths.includes('metadata.backupFailureDomain'));
});

test('RTO·RPO 초과, Writer 세대 점프, Failback·정합성 누락을 차단한다', () => {
  const doc = complete();
  doc.failover.serviceRecoveredAt = '2027-01-02T03:25:01.000Z';
  doc.failover.recoveredThroughAt = '2027-01-02T03:08:59.000Z';
  doc.failover.newWriterEpoch = 9;
  doc.failback.status = 'pending';
  doc.integrity.openReconciliationExceptions = 1;
  const paths = validateDrAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('failover.serviceRecoveredAt'));
  assert(paths.includes('failover.recoveredThroughAt'));
  assert(paths.includes('failover.newWriterEpoch'));
  assert(paths.includes('failback.status'));
  assert(paths.includes('integrity.openReconciliationExceptions'));
});
