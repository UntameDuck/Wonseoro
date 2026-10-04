// 외부 PostgreSQL PITR·DR 수용 증적 게이트 — T-M4-06·T-M5-60·61·64
//
// 사용:
//   node scripts/ops/dr-acceptance.mjs --file=deploy/pilot/<대학>-dr.yaml
//
// 기관이 적은 RTO/RPO 숫자를 그대로 믿지 않고 사건 시각으로 다시 계산한다. 실제 원격 소산
// 백업, Writer fencing, Failback, 사후 대조 증적이 모두 있어야 통과한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
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

function instant(blockers, value, at) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) blockers.push({ at, message: '유효한 시각이 아니다' });
  return ms;
}

export function validateDrAcceptance(document) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};
  const metadata = doc.metadata ?? {};
  requireValue(blockers, metadata.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, metadata.environmentId, 'metadata.environmentId', '환경 ID');
  requireValue(blockers, metadata.csp, 'metadata.csp', 'CSP');
  requireValue(blockers, metadata.deploymentRef, 'metadata.deploymentRef', '배포 참조');
  requireValue(blockers, metadata.primaryZone, 'metadata.primaryZone', 'Primary zone');
  requireValue(blockers, metadata.standbyZone, 'metadata.standbyZone', 'Standby zone');
  requireValue(blockers, metadata.backupFailureDomain, 'metadata.backupFailureDomain', '백업 장애영역');
  requireEvidence(blockers, metadata.evidence, 'metadata.evidence');
  if (metadata.environmentType !== 'csp-dr-staging') blockers.push({ at: 'metadata.environmentType', message: '환경 유형은 csp-dr-staging이어야 한다' });
  if (/kind|local|docker/iu.test(`${metadata.environmentId ?? ''} ${metadata.csp ?? ''}`)) blockers.push({ at: 'metadata.environmentId', message: '로컬·kind 결과는 외부 DR 증적이 아니다' });
  if (hasValue(metadata.primaryZone) && metadata.primaryZone === metadata.standbyZone) blockers.push({ at: 'metadata.standbyZone', message: 'Primary와 Standby가 같은 zone이다' });
  if (hasValue(metadata.backupFailureDomain) && [metadata.primaryZone, metadata.standbyZone].includes(metadata.backupFailureDomain)) blockers.push({ at: 'metadata.backupFailureDomain', message: '백업이 DB와 같은 장애영역에 있다' });

  if (doc.approval?.status !== 'approved') blockers.push({ at: 'approval.status', message: 'DR 훈련 승인이 없다' });
  requireValue(blockers, doc.approval?.approvedAt, 'approval.approvedAt', '승인 시각');
  requireValue(blockers, doc.approval?.scope, 'approval.scope', '승인 범위');
  requireEvidence(blockers, doc.approval?.evidence, 'approval.evidence');

  if (doc.preflight?.passed !== true) blockers.push({ at: 'preflight.passed', message: 'HA 사전 점검이 통과하지 않았다' });
  if (doc.preflight?.automaticChecks !== '13/13') blockers.push({ at: 'preflight.automaticChecks', message: 'HA 자동 점검 13/13 증적이 없다' });
  if (doc.preflight?.skipped !== 0) blockers.push({ at: 'preflight.skipped', message: 'HA 사전 점검 건너뜀이 0이 아니다' });
  requireEvidence(blockers, doc.preflight?.evidence, 'preflight.evidence');

  const backup = doc.backup ?? {};
  if (backup.baseBackupOffsite !== true) blockers.push({ at: 'backup.baseBackupOffsite', message: '기본 백업 원격 소산 증적이 없다' });
  if (backup.walArchiveOffsite !== true) blockers.push({ at: 'backup.walArchiveOffsite', message: 'WAL 원격 소산 증적이 없다' });
  if (backup.encrypted !== true) blockers.push({ at: 'backup.encrypted', message: '백업 암호화 증적이 없다' });
  if (backup.restoreVerificationPassed !== true) blockers.push({ at: 'backup.restoreVerificationPassed', message: '복구본 체크섬·불변식 검증이 통과하지 않았다' });
  if (backup.restoreVerificationSkipped !== 0) blockers.push({ at: 'backup.restoreVerificationSkipped', message: '복구 검증 건너뜀이 0이 아니다' });
  const pitrTarget = instant(blockers, backup.targetRecoveryAt, 'backup.targetRecoveryAt');
  const pitrActual = instant(blockers, backup.actualRecoveryAt, 'backup.actualRecoveryAt');
  if (Number.isFinite(pitrTarget) && Number.isFinite(pitrActual) && Math.abs(pitrActual - pitrTarget) > 1000) {
    blockers.push({ at: 'backup.actualRecoveryAt', message: '목표 복구 시각과 실제 복구 시각 차이가 1초를 넘는다' });
  }
  requireEvidence(blockers, backup.evidence, 'backup.evidence');

  const failover = doc.failover ?? {};
  if (failover.status !== 'passed') blockers.push({ at: 'failover.status', message: 'DR 전환이 통과 상태가 아니다' });
  if (failover.skipped !== 0) blockers.push({ at: 'failover.skipped', message: 'DR 전환 건너뜀이 0이 아니다' });
  if (failover.loadRunning !== true) blockers.push({ at: 'failover.loadRunning', message: '승인된 부하 중 전환한 증적이 없다' });
  const failureAt = instant(blockers, failover.failureAt, 'failover.failureAt');
  const serviceRecoveredAt = instant(blockers, failover.serviceRecoveredAt, 'failover.serviceRecoveredAt');
  const recoveredThroughAt = instant(blockers, failover.recoveredThroughAt, 'failover.recoveredThroughAt');
  const rtoSeconds = Number.isFinite(failureAt) && Number.isFinite(serviceRecoveredAt) ? Math.max(0, (serviceRecoveredAt - failureAt) / 1000) : null;
  const rpoSeconds = Number.isFinite(failureAt) && Number.isFinite(recoveredThroughAt) ? Math.max(0, (failureAt - recoveredThroughAt) / 1000) : null;
  if (rtoSeconds !== null && rtoSeconds > 900) blockers.push({ at: 'failover.serviceRecoveredAt', message: `RTO가 15분을 넘었다(${rtoSeconds}초)` });
  if (rpoSeconds !== null && rpoSeconds > 60) blockers.push({ at: 'failover.recoveredThroughAt', message: `RPO가 1분을 넘었다(${rpoSeconds}초)` });
  if (!Number.isInteger(failover.oldWriterEpoch) || failover.oldWriterEpoch < 1) blockers.push({ at: 'failover.oldWriterEpoch', message: '전환 전 Writer 세대가 없다' });
  if (!Number.isInteger(failover.newWriterEpoch) || failover.newWriterEpoch !== failover.oldWriterEpoch + 1) blockers.push({ at: 'failover.newWriterEpoch', message: 'Writer 세대가 정확히 1 증가하지 않았다' });
  if (failover.oldWriterRejected !== true) blockers.push({ at: 'failover.oldWriterRejected', message: '옛 Writer 쓰기 거절 증적이 없다' });
  if (failover.dnsOrEdgeSwitched !== true) blockers.push({ at: 'failover.dnsOrEdgeSwitched', message: 'DNS/Edge 전환 증적이 없다' });
  requireEvidence(blockers, failover.evidence, 'failover.evidence');

  if (doc.failback?.status !== 'completed') blockers.push({ at: 'failback.status', message: 'Failback이 완료되지 않았다' });
  if (doc.failback?.rebuiltFromCurrentWriter !== true) blockers.push({ at: 'failback.rebuiltFromCurrentWriter', message: '옛 Primary를 현재 Writer 기준으로 다시 만들지 않았다' });
  if (doc.failback?.skipped !== 0) blockers.push({ at: 'failback.skipped', message: 'Failback 건너뜀이 0이 아니다' });
  requireValue(blockers, doc.failback?.completedAt, 'failback.completedAt', 'Failback 완료 시각');
  requireEvidence(blockers, doc.failback?.evidence, 'failback.evidence');

  requireZero(blockers, doc.integrity?.lostCommittedTransactions, 'integrity.lostCommittedTransactions', '유실된 커밋');
  requireZero(blockers, doc.integrity?.duplicateSubmissions, 'integrity.duplicateSubmissions', '중복 접수');
  requireZero(blockers, doc.integrity?.doubleConfirmedPayments, 'integrity.doubleConfirmedPayments', '이중 승인 결제');
  requireZero(blockers, doc.integrity?.unrecoveredSequenceGaps, 'integrity.unrecoveredSequenceGaps', '미복구 이벤트 순번 공백');
  requireZero(blockers, doc.integrity?.openReconciliationExceptions, 'integrity.openReconciliationExceptions', '미처리 대조 예외');
  requireValue(blockers, doc.integrity?.checkedAt, 'integrity.checkedAt', '사후 대조 시각');
  requireEvidence(blockers, doc.integrity?.evidence, 'integrity.evidence');

  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      automaticChecks: doc.preflight?.automaticChecks ?? '0/13',
      rtoSeconds,
      rpoSeconds,
      oldWriterEpoch: Number.isInteger(failover.oldWriterEpoch) && failover.oldWriterEpoch >= 1 ? failover.oldWriterEpoch : null,
      newWriterEpoch: Number.isInteger(failover.newWriterEpoch) && failover.newWriterEpoch >= 2 ? failover.newWriterEpoch : null,
      skipped: [doc.preflight?.skipped, backup.restoreVerificationSkipped, failover.skipped, doc.failback?.skipped]
        .reduce((sum, value) => sum + (Number.isInteger(value) && value >= 0 ? value : 0), 0),
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/dr-acceptance.mjs --file=deploy/pilot/<대학>-dr.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const validation = validateDrAcceptance(document);
  const result = {
    test: '외부 PostgreSQL PITR·DR 수용 증적 게이트 (T-M4-06·T-M5-60·61·64)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null,
    environmentId: document?.metadata?.environmentId ?? null,
    ...validation,
  };
  console.log(`${result.passed ? '✔' : '✘'} PITR·DR ${result.universityId ?? '(대학 없음)'} / ${result.environmentId ?? '(환경 없음)'}`);
  console.log(`  HA ${result.summary.automaticChecks}, RTO ${result.summary.rtoSeconds ?? '-'}초, RPO ${result.summary.rpoSeconds ?? '-'}초, Writer ${result.summary.oldWriterEpoch ?? '-'}→${result.summary.newWriterEpoch ?? '-'}, 건너뜀 ${result.summary.skipped}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const stamp = result.at.replace(/[:.]/g, '-');
    const out = path.join(dir, `dr-acceptance-${slug}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
