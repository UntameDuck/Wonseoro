// Pilot 진입 증적 게이트 — T-M6-08·09·10·12·13·15와 노션 v1.0 §14·16·19
//
// 사용:
//   node scripts/ops/pilot-readiness.mjs --file=deploy/pilot/<대학>-<전형>.yaml
//
// 문서가 있다는 사실이 아니라 승인·실행 증적이 모두 있는지를 판정한다. 실제 환경 수치와 기관 판단을
// 저장소가 대신 만들지 않는다. 결과는 tests/ops/results/pilot-readiness-<대학>-<시각>.json 이다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const CALENDAR_WINDOWS = [
  'd-180~120',
  'd-120~60',
  'd-60~30',
  'd-30~14',
  'd-14~7',
  'd-7~1',
  'admission',
  'd+1~7',
  'd+7~30',
];

export const REQUIRED_TESTS = [
  'unit',
  'api-contract',
  'db-migration',
  'payment-sandbox-e2e',
  'browser-compatibility',
  'kwcag-manual',
  'sast-sca-secret',
  'dast-penetration',
  'container-iac-scan',
  'load',
  'soak-6h',
  'finalization-burst',
  'pod-node-chaos',
  'db-failover',
  'central-disconnect',
  'pg-timeout',
  'backup-restore',
  'dr-switch',
];

export const COMPLIANCE_DOMAINS = [
  'krds',
  'kwcag-wcag',
  'web-compatibility',
  'secure-development',
  'privacy-safeguards',
  'isms-p',
  'kcmvp',
  'csap',
  'stability-notice',
  'service-quality',
];

export const INCIDENT_ROLES = [
  'incident-commander',
  'university-admissions',
  'sre-noc',
  'soc-security',
  'privacy',
  'helpdesk',
  'pg',
];

export const WAR_ROOM_INJECTS = [
  'finalization-outage',
  'payment-delay',
  'db-failover',
  'central-disconnect',
  'communications',
];

export const SHADOW_STAGES = ['sandbox', 'shadow', 'limited-pilot'];

const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
const list = (value) => (Array.isArray(value) ? value : []);

function requireValue(blockers, value, at, label = at) {
  if (!hasValue(value)) blockers.push({ at, message: `${label} 값이 없다` });
}

function requireEvidence(blockers, value, at) {
  const evidence = list(value).filter(hasValue);
  if (evidence.length === 0) blockers.push({ at, message: '실행·승인 증적이 없다' });
}

function checkExpectedRows(blockers, rows, expected, at, validate) {
  const safeRows = list(rows);
  const counts = new Map();
  for (const row of safeRows) {
    if (!row || typeof row !== 'object') {
      blockers.push({ at, message: '객체가 아닌 행이 있다' });
      continue;
    }
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    if (!expected.includes(row.id)) blockers.push({ at: `${at}.${row.id ?? '?'}`, message: '알 수 없는 ID다' });
  }
  for (const id of expected) {
    const count = counts.get(id) ?? 0;
    if (count === 0) blockers.push({ at: `${at}.${id}`, message: '필수 행이 없다' });
    if (count > 1) blockers.push({ at: `${at}.${id}`, message: '같은 ID가 두 번 이상 있다' });
    const row = safeRows.find((candidate) => candidate?.id === id);
    if (row) validate(row, `${at}.${id}`);
  }
}

export function validatePilotReadiness(document) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};

  requireValue(blockers, doc.metadata?.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, doc.metadata?.admissionCycle, 'metadata.admissionCycle', '전형 주기');
  requireValue(blockers, doc.metadata?.targetStartDate, 'metadata.targetStartDate', '접수 시작일');
  requireValue(blockers, doc.metadata?.ownerOrganization, 'metadata.ownerOrganization', '책임 기관');

  if (doc.runbook?.status !== 'approved') blockers.push({ at: 'runbook.status', message: '런북이 기관 승인 상태가 아니다' });
  requireValue(blockers, doc.runbook?.approvedAt, 'runbook.approvedAt', '런북 승인 시각');
  requireEvidence(blockers, doc.runbook?.evidence, 'runbook.evidence');
  checkExpectedRows(blockers, doc.runbook?.roles, INCIDENT_ROLES, 'runbook.roles', (row, at) => {
    requireValue(blockers, row.owner, `${at}.owner`, '담당 조직·역할');
    requireValue(blockers, row.contactRef, `${at}.contactRef`, '비상 연락망 참조');
    requireValue(blockers, row.backupOwner, `${at}.backupOwner`, '대체 담당 조직·역할');
  });

  checkExpectedRows(blockers, doc.calendar, CALENDAR_WINDOWS, 'calendar', (row, at) => {
    if (row.status !== 'completed') blockers.push({ at: `${at}.status`, message: '운영주기 확인이 완료되지 않았다' });
    requireValue(blockers, row.owner, `${at}.owner`, '구간 책임자');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  });

  if (doc.warRoom?.status !== 'completed') blockers.push({ at: 'warRoom.status', message: 'War-room 훈련이 완료되지 않았다' });
  requireValue(blockers, doc.warRoom?.heldAt, 'warRoom.heldAt', '훈련 시각');
  requireValue(blockers, doc.warRoom?.incidentCommander, 'warRoom.incidentCommander', '훈련 IC');
  requireEvidence(blockers, doc.warRoom?.evidence, 'warRoom.evidence');
  checkExpectedRows(blockers, doc.warRoom?.injects, WAR_ROOM_INJECTS, 'warRoom.injects', (row, at) => {
    if (row.status !== 'observed') blockers.push({ at: `${at}.status`, message: '상황 주입을 관찰하지 않았다' });
    requireValue(blockers, row.result, `${at}.result`, '관찰 결과');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  });

  const impactDecision = doc.privacyImpact?.decision;
  if (!['required', 'not-required'].includes(impactDecision)) {
    blockers.push({ at: 'privacyImpact.decision', message: '영향평가 대상 여부가 확정되지 않았다' });
  }
  if (doc.privacyImpact?.status !== 'approved') blockers.push({ at: 'privacyImpact.status', message: '개인정보 담당자 승인이 없다' });
  requireValue(blockers, doc.privacyImpact?.basis, 'privacyImpact.basis', '대상 여부 판단 근거');
  requireValue(blockers, doc.privacyImpact?.approvedAt, 'privacyImpact.approvedAt', '판단 승인 시각');
  requireEvidence(blockers, doc.privacyImpact?.evidence, 'privacyImpact.evidence');

  checkExpectedRows(blockers, doc.tests, REQUIRED_TESTS, 'tests', (row, at) => {
    if (row.status !== 'passed') blockers.push({ at: `${at}.status`, message: '필수 시험이 통과 상태가 아니다' });
    requireValue(blockers, row.environment, `${at}.environment`, '실행 환경');
    requireValue(blockers, row.executedAt, `${at}.executedAt`, '실행 시각');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
    if (typeof row.skipped !== 'number' || row.skipped < 0) blockers.push({ at: `${at}.skipped`, message: '건너뜀 수가 숫자로 기록되지 않았다' });
  });

  checkExpectedRows(blockers, doc.compliance, COMPLIANCE_DOMAINS, 'compliance', (row, at) => {
    if (!['compliant', 'not-applicable'].includes(row.verdict)) blockers.push({ at: `${at}.verdict`, message: '적합/비대상 판정이 없다' });
    requireValue(blockers, row.owner, `${at}.owner`, '판정 책임자');
    requireValue(blockers, row.basis, `${at}.basis`, '판정 근거');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  });

  checkExpectedRows(blockers, doc.shadowTest?.stages, SHADOW_STAGES, 'shadowTest.stages', (row, at) => {
    if (row.status !== 'completed') blockers.push({ at: `${at}.status`, message: '단계가 완료되지 않았다' });
    requireValue(blockers, row.approvedBy, `${at}.approvedBy`, '기관 승인자');
    requireValue(blockers, row.completedAt, `${at}.completedAt`, '완료 시각');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  });
  requireValue(blockers, doc.shadowTest?.feedbackDisposition, 'shadowTest.feedbackDisposition', 'Pilot 피드백 반영 결과');
  requireEvidence(blockers, doc.shadowTest?.evidence, 'shadowTest.evidence');

  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      calendar: `${list(doc.calendar).filter((row) => row?.status === 'completed').length}/${CALENDAR_WINDOWS.length}`,
      tests: `${list(doc.tests).filter((row) => row?.status === 'passed').length}/${REQUIRED_TESTS.length}`,
      compliance: `${list(doc.compliance).filter((row) => ['compliant', 'not-applicable'].includes(row?.verdict)).length}/${COMPLIANCE_DOMAINS.length}`,
      shadowStages: `${list(doc.shadowTest?.stages).filter((row) => row?.status === 'completed').length}/${SHADOW_STAGES.length}`,
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/pilot-readiness.mjs --file=deploy/pilot/<대학>-<전형>.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const validation = validatePilotReadiness(document);
  const result = {
    test: 'Pilot 진입 증적 게이트 (T-M6-08·09·10·12·13·15)',
    at: new Date().toISOString(),
    source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null,
    admissionCycle: document?.metadata?.admissionCycle ?? null,
    ...validation,
  };

  console.log(`${result.passed ? '✔' : '✘'} Pilot 준비 ${result.universityId ?? '(대학 없음)'} / ${result.admissionCycle ?? '(전형 없음)'}`);
  console.log(`  운영주기 ${result.summary.calendar}, 필수 시험 ${result.summary.tests}, Compliance ${result.summary.compliance}, Shadow ${result.summary.shadowStages}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);

  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/ops/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const stamp = result.at.replace(/[:.]/g, '-');
    const out = path.join(dir, `pilot-readiness-${slug}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
