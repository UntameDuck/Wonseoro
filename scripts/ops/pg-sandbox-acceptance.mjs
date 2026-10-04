// 실 PG Sandbox 수용 증적 게이트 — T-M6-04·05
//
// 사용:
//   node scripts/ops/pg-sandbox-acceptance.mjs --file=deploy/pilot/<대학>-pg-sandbox.yaml
//
// 벤더 API나 비밀을 저장소에 넣지 않고, 실제 계약 계정에서 결제·콜백·재확인·정산을
// 실행했다는 재현 가능한 참조만 판정한다. Mock 결과와 건너뛴 시험은 통과하지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const PAYMENT_CASES = [
  'intent-unique',
  'server-verification',
  'amount-verification',
  'invalid-callback-signature',
  'callback-server-reverification',
  'callback-replay',
  'closed-window-recovery',
  'pending-unknown-retry',
  'approved-cancellation',
];

export const RECONCILIATION_CASES = [
  'matched',
  'local-only',
  'provider-only',
  'status-mismatch',
  'amount-mismatch',
];

const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
const list = (value) => (Array.isArray(value) ? value : []);

function requireValue(blockers, value, at, label = at) {
  if (!hasValue(value)) blockers.push({ at, message: `${label} 값이 없다` });
}

function requireEvidence(blockers, value, at) {
  if (list(value).filter(hasValue).length === 0) blockers.push({ at, message: '실행 증적 참조가 없다' });
}

function checkRows(blockers, rows, expected, at) {
  const safeRows = list(rows);
  const counts = new Map();
  for (const row of safeRows) {
    if (!row || typeof row !== 'object') {
      blockers.push({ at, message: '객체가 아닌 행이 있다' });
      continue;
    }
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    if (!expected.includes(row.id)) blockers.push({ at: `${at}.${row.id ?? '?'}`, message: '알 수 없는 시험 ID다' });
  }
  for (const id of expected) {
    const count = counts.get(id) ?? 0;
    const itemAt = `${at}.${id}`;
    if (count === 0) blockers.push({ at: itemAt, message: '필수 시험이 없다' });
    if (count > 1) blockers.push({ at: itemAt, message: '같은 시험이 두 번 이상 있다' });
    const row = safeRows.find((candidate) => candidate?.id === id);
    if (!row) continue;
    if (row.status !== 'passed') blockers.push({ at: `${itemAt}.status`, message: '시험이 통과 상태가 아니다' });
    if (row.skipped !== 0) blockers.push({ at: `${itemAt}.skipped`, message: '실계정 수용 시험은 건너뜀 0건이어야 한다' });
    requireValue(blockers, row.executedAt, `${itemAt}.executedAt`, '실행 시각');
    requireValue(blockers, row.observed, `${itemAt}.observed`, '관찰 결과');
    requireEvidence(blockers, row.evidence, `${itemAt}.evidence`);
    if (!SHA256.test(row.transactionSetHash ?? '')) {
      blockers.push({ at: `${itemAt}.transactionSetHash`, message: '거래 원문 대신 소문자 SHA-256 집합 해시를 기록해야 한다' });
    }
  }
}

export function validatePgSandboxAcceptance(document) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};
  const metadata = doc.metadata ?? {};

  requireValue(blockers, metadata.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, metadata.admissionCycle, 'metadata.admissionCycle', '전형 주기');
  requireValue(blockers, metadata.provider, 'metadata.provider', 'PG 사업자');
  requireValue(blockers, metadata.environmentId, 'metadata.environmentId', 'Sandbox 환경 ID');
  requireValue(blockers, metadata.adapterVersion, 'metadata.adapterVersion', '어댑터 버전');
  requireValue(blockers, metadata.deploymentRef, 'metadata.deploymentRef', '배포 참조');
  requireValue(blockers, metadata.executedAt, 'metadata.executedAt', '실행 시각');
  requireValue(blockers, metadata.approvedBy, 'metadata.approvedBy', '승인자');
  requireEvidence(blockers, metadata.evidence, 'metadata.evidence');
  if (/(?:^|[-_\s])mock(?:$|[-_\s])|mock-pg/iu.test(metadata.provider ?? '')) {
    blockers.push({ at: 'metadata.provider', message: 'Mock PG 결과는 실계정 수용 증적이 아니다' });
  }
  if (metadata.environmentType !== 'pg-sandbox') {
    blockers.push({ at: 'metadata.environmentType', message: '환경 유형은 pg-sandbox여야 한다' });
  }
  if (metadata.syntheticDataOnly !== true) {
    blockers.push({ at: 'metadata.syntheticDataOnly', message: '합성 데이터 전용 실행 확인이 필요하다' });
  }
  if (!SHA256.test(metadata.merchantAccountRefHash ?? '')) {
    blockers.push({ at: 'metadata.merchantAccountRefHash', message: '가맹점 계정 참조는 원문 대신 소문자 SHA-256 해시로 기록해야 한다' });
  }

  if (doc.approval?.status !== 'approved') blockers.push({ at: 'approval.status', message: '대학·PG 실행 승인이 없다' });
  requireValue(blockers, doc.approval?.approvedAt, 'approval.approvedAt', '승인 시각');
  requireValue(blockers, doc.approval?.scope, 'approval.scope', '승인 범위');
  requireEvidence(blockers, doc.approval?.evidence, 'approval.evidence');

  checkRows(blockers, doc.paymentCases, PAYMENT_CASES, 'paymentCases');
  checkRows(blockers, doc.reconciliationCases, RECONCILIATION_CASES, 'reconciliationCases');

  if (doc.finalState?.openReconciliationExceptions !== 0) {
    blockers.push({ at: 'finalState.openReconciliationExceptions', message: '미처리 정산 예외가 0이 아니다' });
  }
  if (doc.finalState?.duplicateConfirmedPayments !== 0) {
    blockers.push({ at: 'finalState.duplicateConfirmedPayments', message: '중복 승인 결제가 0이 아니다' });
  }
  if (doc.finalState?.unfinalizedConfirmedPayments !== 0) {
    blockers.push({ at: 'finalState.unfinalizedConfirmedPayments', message: '접수로 이어지지 않은 승인 결제가 0이 아니다' });
  }
  requireValue(blockers, doc.finalState?.checkedAt, 'finalState.checkedAt', '사후 대조 시각');
  requireEvidence(blockers, doc.finalState?.evidence, 'finalState.evidence');

  const passedPayment = list(doc.paymentCases).filter((row) => row?.status === 'passed' && row?.skipped === 0).length;
  const passedReconciliation = list(doc.reconciliationCases).filter((row) => row?.status === 'passed' && row?.skipped === 0).length;
  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      payment: `${passedPayment}/${PAYMENT_CASES.length}`,
      reconciliation: `${passedReconciliation}/${RECONCILIATION_CASES.length}`,
      skipped: [...list(doc.paymentCases), ...list(doc.reconciliationCases)]
        .reduce((sum, row) => sum + (Number.isInteger(row?.skipped) ? row.skipped : 0), 0),
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/pg-sandbox-acceptance.mjs --file=deploy/pilot/<대학>-pg-sandbox.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const validation = validatePgSandboxAcceptance(document);
  const result = {
    test: '실 PG Sandbox 수용 증적 게이트 (T-M6-04·05)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null,
    admissionCycle: document?.metadata?.admissionCycle ?? null,
    provider: document?.metadata?.provider ?? null,
    ...validation,
  };

  console.log(`${result.passed ? '✔' : '✘'} 실 PG Sandbox ${result.universityId ?? '(대학 없음)'} / ${result.provider ?? '(PG 없음)'}`);
  console.log(`  결제 ${result.summary.payment}, 정산 ${result.summary.reconciliation}, 건너뜀 ${result.summary.skipped}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);

  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const stamp = result.at.replace(/[:.]/g, '-');
    const out = path.join(dir, `pg-sandbox-acceptance-${slug}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
