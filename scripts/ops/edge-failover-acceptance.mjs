// CSP Edge·노드 장애 수용 증적 게이트 — T-M4-39, ADR-0008
//
// 사용:
//   node scripts/ops/edge-failover-acceptance.mjs --file=deploy/pilot/<대학>-edge-failover.yaml
//
// 실제 Edge/Gateway와 다중 zone에서 계획 정비·노드 손실을 실행한 결과만 받는다.
// 재시도가 장애를 숨겼다는 사실과 중복 쓰기가 없다는 사실을 같이 요구한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SCENARIOS = ['planned-drain', 'hard-node-loss'];
const REQUIRED_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const REQUIRED_RETRY_REASONS = ['connect-failure', 'reset', 'unavailable'];
const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
const list = (value) => (Array.isArray(value) ? value : []);

function requireValue(blockers, value, at, label = at) {
  if (!hasValue(value)) blockers.push({ at, message: `${label} 값이 없다` });
}

function requireEvidence(blockers, value, at) {
  if (list(value).filter(hasValue).length === 0) blockers.push({ at, message: '실행 증적 참조가 없다' });
}

function requireZero(blockers, value, at, label) {
  if (value !== 0) blockers.push({ at, message: `${label} 값이 0이 아니다` });
}

export function validateEdgeFailoverAcceptance(document) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};
  const metadata = doc.metadata ?? {};

  requireValue(blockers, metadata.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, metadata.environmentId, 'metadata.environmentId', '환경 ID');
  requireValue(blockers, metadata.csp, 'metadata.csp', 'CSP');
  requireValue(blockers, metadata.gatewayClass, 'metadata.gatewayClass', 'GatewayClass');
  requireValue(blockers, metadata.deploymentRef, 'metadata.deploymentRef', '배포 참조');
  requireValue(blockers, metadata.executedAt, 'metadata.executedAt', '실행 시각');
  requireEvidence(blockers, metadata.evidence, 'metadata.evidence');
  if (metadata.environmentType !== 'csp-staging') {
    blockers.push({ at: 'metadata.environmentType', message: '환경 유형은 실제 Edge가 있는 csp-staging이어야 한다' });
  }
  if (/kind|local|docker/iu.test(`${metadata.environmentId ?? ''} ${metadata.csp ?? ''}`)) {
    blockers.push({ at: 'metadata.environmentId', message: '로컬·kind 결과는 외부 Edge 판정 증적이 아니다' });
  }
  const zones = new Set(list(metadata.zones).filter(hasValue));
  if (zones.size < 2) blockers.push({ at: 'metadata.zones', message: '서로 다른 zone이 두 곳 이상 증명되지 않았다' });

  if (doc.approval?.status !== 'approved') blockers.push({ at: 'approval.status', message: '노드 장애 시험 승인이 없다' });
  requireValue(blockers, doc.approval?.approvedAt, 'approval.approvedAt', '승인 시각');
  requireValue(blockers, doc.approval?.scope, 'approval.scope', '승인 범위');
  requireEvidence(blockers, doc.approval?.evidence, 'approval.evidence');

  const retry = doc.retryPolicy ?? {};
  for (const method of REQUIRED_SAFE_METHODS) {
    if (!list(retry.safeMethods).includes(method)) blockers.push({ at: 'retryPolicy.safeMethods', message: `${method} 재시도 정책이 없다` });
  }
  if (retry.idempotentWriteRequiresKey !== true) {
    blockers.push({ at: 'retryPolicy.idempotentWriteRequiresKey', message: '쓰기 재시도에 멱등 키를 강제하지 않는다' });
  }
  if (retry.retryUnsafeWrites !== false) {
    blockers.push({ at: 'retryPolicy.retryUnsafeWrites', message: '멱등성이 보장되지 않은 쓰기 재시도는 금지해야 한다' });
  }
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 2 || retry.maxAttempts > 4) {
    blockers.push({ at: 'retryPolicy.maxAttempts', message: '최대 시도 횟수는 2~4여야 한다' });
  }
  if (!Number.isInteger(retry.perTryTimeoutMs) || retry.perTryTimeoutMs <= 0) {
    blockers.push({ at: 'retryPolicy.perTryTimeoutMs', message: '시도별 양의 timeout이 없다' });
  }
  for (const reason of REQUIRED_RETRY_REASONS) {
    if (!list(retry.retryOn).includes(reason)) blockers.push({ at: 'retryPolicy.retryOn', message: `${reason} 재시도 근거가 없다` });
  }
  requireEvidence(blockers, retry.evidence, 'retryPolicy.evidence');

  if (doc.healthCheck?.active !== true) blockers.push({ at: 'healthCheck.active', message: 'Edge 능동 상태 확인이 켜져 있지 않다' });
  if (!Number.isInteger(doc.healthCheck?.intervalSeconds) || doc.healthCheck.intervalSeconds <= 0) {
    blockers.push({ at: 'healthCheck.intervalSeconds', message: '상태 확인 주기가 없다' });
  }
  if (!Number.isInteger(doc.healthCheck?.unhealthyThreshold) || doc.healthCheck.unhealthyThreshold <= 0) {
    blockers.push({ at: 'healthCheck.unhealthyThreshold', message: '비정상 판정 횟수가 없다' });
  }
  requireEvidence(blockers, doc.healthCheck?.evidence, 'healthCheck.evidence');

  const rows = list(doc.scenarios);
  for (const id of SCENARIOS) {
    const matching = rows.filter((row) => row?.id === id);
    const at = `scenarios.${id}`;
    if (matching.length === 0) {
      blockers.push({ at, message: '필수 시나리오가 없다' });
      continue;
    }
    if (matching.length > 1) blockers.push({ at, message: '같은 시나리오가 두 번 이상 있다' });
    const row = matching[0];
    if (row.status !== 'passed') blockers.push({ at: `${at}.status`, message: '시나리오가 통과 상태가 아니다' });
    if (row.skipped !== 0) blockers.push({ at: `${at}.skipped`, message: '외부 수용 시험은 건너뜀 0건이어야 한다' });
    if (!Number.isInteger(row.requests) || row.requests <= 0) blockers.push({ at: `${at}.requests`, message: '실행 요청 수가 없다' });
    if (!Number.isInteger(row.firstAttemptFailures) || row.firstAttemptFailures < 0) blockers.push({ at: `${at}.firstAttemptFailures`, message: '첫 시도 실패 수가 없다' });
    if (!Number.isInteger(row.edgeRetriedRequests) || row.edgeRetriedRequests < 0) blockers.push({ at: `${at}.edgeRetriedRequests`, message: 'Edge 재시도 수가 없다' });
    if (id === 'hard-node-loss' && row.edgeRetriedRequests <= 0) blockers.push({ at: `${at}.edgeRetriedRequests`, message: '강제 장애에서 실제 Edge 재시도가 관찰되지 않았다' });
    requireZero(blockers, row.userVisibleFailures, `${at}.userVisibleFailures`, '사용자 체감 실패');
    requireZero(blockers, row.duplicateWrites, `${at}.duplicateWrites`, '중복 쓰기');
    if (!Number.isFinite(row.observedRecoverySeconds) || row.observedRecoverySeconds < 0) blockers.push({ at: `${at}.observedRecoverySeconds`, message: '관찰 복구 시간이 없다' });
    if (!Number.isFinite(row.targetRecoverySeconds) || row.targetRecoverySeconds <= 0) blockers.push({ at: `${at}.targetRecoverySeconds`, message: '승인된 복구 목표가 없다' });
    if (Number.isFinite(row.observedRecoverySeconds) && Number.isFinite(row.targetRecoverySeconds) && row.observedRecoverySeconds > row.targetRecoverySeconds) {
      blockers.push({ at: `${at}.observedRecoverySeconds`, message: '관찰 복구 시간이 승인 목표를 넘었다' });
    }
    requireValue(blockers, row.startedAt, `${at}.startedAt`, '시작 시각');
    requireValue(blockers, row.endedAt, `${at}.endedAt`, '종료 시각');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  }
  for (const row of rows) {
    if (!SCENARIOS.includes(row?.id)) blockers.push({ at: `scenarios.${row?.id ?? '?'}`, message: '알 수 없는 시나리오 ID다' });
  }

  requireZero(blockers, doc.integrity?.duplicateSubmissions, 'integrity.duplicateSubmissions', '중복 접수');
  requireZero(blockers, doc.integrity?.doubleConfirmedPayments, 'integrity.doubleConfirmedPayments', '이중 승인 결제');
  requireZero(blockers, doc.integrity?.unrecoveredSequenceGaps, 'integrity.unrecoveredSequenceGaps', '미복구 이벤트 순번 공백');
  requireValue(blockers, doc.integrity?.checkedAt, 'integrity.checkedAt', '사후 정합성 확인 시각');
  requireEvidence(blockers, doc.integrity?.evidence, 'integrity.evidence');

  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      scenarios: `${rows.filter((row) => row?.status === 'passed' && row?.skipped === 0).length}/${SCENARIOS.length}`,
      requests: rows.reduce((sum, row) => sum + (Number.isInteger(row?.requests) ? row.requests : 0), 0),
      edgeRetries: rows.reduce((sum, row) => sum + (Number.isInteger(row?.edgeRetriedRequests) ? row.edgeRetriedRequests : 0), 0),
      userVisibleFailures: rows.reduce((sum, row) => sum + (Number.isInteger(row?.userVisibleFailures) && row.userVisibleFailures >= 0 ? row.userVisibleFailures : 0), 0),
      skipped: rows.reduce((sum, row) => sum + (Number.isInteger(row?.skipped) ? row.skipped : 0), 0),
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/edge-failover-acceptance.mjs --file=deploy/pilot/<대학>-edge-failover.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const validation = validateEdgeFailoverAcceptance(document);
  const result = {
    test: 'CSP Edge·노드 장애 수용 증적 게이트 (T-M4-39)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null,
    environmentId: document?.metadata?.environmentId ?? null,
    ...validation,
  };
  console.log(`${result.passed ? '✔' : '✘'} Edge·노드 장애 ${result.universityId ?? '(대학 없음)'} / ${result.environmentId ?? '(환경 없음)'}`);
  console.log(`  시나리오 ${result.summary.scenarios}, 요청 ${result.summary.requests}, Edge 재시도 ${result.summary.edgeRetries}, 사용자 체감 실패 ${result.summary.userVisibleFailures}, 건너뜀 ${result.summary.skipped}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const stamp = result.at.replace(/[:.]/g, '-');
    const out = path.join(dir, `edge-failover-acceptance-${slug}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
