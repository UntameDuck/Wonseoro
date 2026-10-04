import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYMENT_CASES,
  RECONCILIATION_CASES,
  validatePgSandboxAcceptance,
} from './pg-sandbox-acceptance.mjs';

const hash = 'a'.repeat(64);
const evidence = ['ticket://PG-SANDBOX-1'];
const row = (id) => ({
  id,
  status: 'passed',
  skipped: 0,
  executedAt: '2027-01-02T03:04:05+09:00',
  observed: '기대 상태와 저장 상태가 일치함',
  transactionSetHash: hash,
  evidence,
});

const complete = () => ({
  metadata: {
    universityId: 'UNIV-A',
    admissionCycle: '2027-early',
    provider: 'contracted-pg',
    environmentType: 'pg-sandbox',
    environmentId: 'sandbox-a',
    adapterVersion: 'git:0123456',
    deploymentRef: 'deploy://pilot/0123456',
    merchantAccountRefHash: hash,
    syntheticDataOnly: true,
    executedAt: '2027-01-02T03:04:05+09:00',
    approvedBy: '대학 결제 책임자',
    evidence,
  },
  approval: { status: 'approved', approvedAt: '2027-01-01T09:00:00+09:00', scope: 'Sandbox 결제·취소·정산', evidence },
  paymentCases: PAYMENT_CASES.map(row),
  reconciliationCases: RECONCILIATION_CASES.map(row),
  finalState: {
    checkedAt: '2027-01-02T04:00:00+09:00',
    openReconciliationExceptions: 0,
    duplicateConfirmedPayments: 0,
    unfinalizedConfirmedPayments: 0,
    evidence,
  },
});

test('실계정 실행·승인·사후 대조가 모두 있으면 통과한다', () => {
  const result = validatePgSandboxAcceptance(complete());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { payment: '9/9', reconciliation: '5/5', skipped: 0 });
});

test('Mock PG와 건너뛴 시험은 통과시키지 않는다', () => {
  const doc = complete();
  doc.metadata.provider = 'mock-pg';
  doc.paymentCases[0].skipped = 1;
  const result = validatePgSandboxAcceptance(doc);
  assert.equal(result.passed, false);
  assert(result.blockers.some((item) => item.at === 'metadata.provider'));
  assert(result.blockers.some((item) => item.at === 'paymentCases.intent-unique.skipped'));
});

test('누락·중복·원문 계정 참조·미처리 예외를 차단한다', () => {
  const doc = complete();
  doc.paymentCases = doc.paymentCases.filter((item) => item.id !== 'callback-replay');
  doc.reconciliationCases.push({ ...doc.reconciliationCases[0] });
  doc.metadata.merchantAccountRefHash = 'merchant-plain-text';
  doc.finalState.openReconciliationExceptions = 1;
  const result = validatePgSandboxAcceptance(doc);
  const paths = result.blockers.map((item) => item.at);
  assert(paths.includes('paymentCases.callback-replay'));
  assert(paths.includes('reconciliationCases.matched'));
  assert(paths.includes('metadata.merchantAccountRefHash'));
  assert(paths.includes('finalState.openReconciliationExceptions'));
});
