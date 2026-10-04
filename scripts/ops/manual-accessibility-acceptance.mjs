// 실물 브라우저·수동 접근성 수용 증적 게이트 — T-M5-47·48
//
// 사용:
//   node scripts/ops/manual-accessibility-acceptance.mjs --file=deploy/pilot/<대학>-manual-a11y.yaml
//
// 자동 접근성 트리 검사를 사람의 실제 청취·확대·음성 입력으로 대체하지 않는다. 실물 기기와
// 보조기기에서 건너뜀 없이 실행한 증적과 차단 결함 0건을 요구한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BROWSER_CASES = ['firefox-windows', 'safari-ios'];
export const BROWSER_FLOWS = ['applicant-journey', 'oidc-login', 'session-dialog', 'keyboard-focus', 'zoom-reflow', 'file-upload'];
export const ASSISTIVE_CASES = ['screen-reader-desktop', 'screen-reader-mobile', 'zoom-200', 'voice-input'];
const PLACEHOLDER = /^(?:tbd|todo|미정|입력|없음|n\/a|<.*>)$/iu;
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
const list = (value) => (Array.isArray(value) ? value : []);

function requireValue(blockers, value, at, label = at) {
  if (!hasValue(value)) blockers.push({ at, message: `${label} 값이 없다` });
}
function requireEvidence(blockers, value, at) {
  if (list(value).filter(hasValue).length === 0) blockers.push({ at, message: '실행 증적 참조가 없다' });
}
function checkRows(blockers, rows, expected, at, validate) {
  const safeRows = list(rows);
  for (const id of expected) {
    const matching = safeRows.filter((row) => row?.id === id);
    const itemAt = `${at}.${id}`;
    if (matching.length === 0) {
      blockers.push({ at: itemAt, message: '필수 검사 행이 없다' });
      continue;
    }
    if (matching.length > 1) blockers.push({ at: itemAt, message: '같은 검사 행이 두 번 이상 있다' });
    validate(matching[0], itemAt);
  }
  for (const row of safeRows) if (!expected.includes(row?.id)) blockers.push({ at: `${at}.${row?.id ?? '?'}`, message: '알 수 없는 검사 ID다' });
}

export function validateManualAccessibilityAcceptance(document) {
  const blockers = [];
  const doc = document && typeof document === 'object' ? document : {};
  requireValue(blockers, doc.metadata?.universityId, 'metadata.universityId', '대학 ID');
  requireValue(blockers, doc.metadata?.candidateCommit, 'metadata.candidateCommit', '후보 commit');
  requireValue(blockers, doc.metadata?.executedAt, 'metadata.executedAt', '실행 시각');
  requireValue(blockers, doc.metadata?.tester, 'metadata.tester', '검사자');
  requireEvidence(blockers, doc.metadata?.evidence, 'metadata.evidence');

  checkRows(blockers, doc.browsers, BROWSER_CASES, 'browsers', (row, at) => {
    if (row.status !== 'passed') blockers.push({ at: `${at}.status`, message: '실물 브라우저 검사가 통과 상태가 아니다' });
    if (row.skipped !== 0) blockers.push({ at: `${at}.skipped`, message: '실물 브라우저 검사는 건너뜀 0건이어야 한다' });
    if (row.realDevice !== true) blockers.push({ at: `${at}.realDevice`, message: '실물 기기 실행이 아니다' });
    requireValue(blockers, row.browserVersion, `${at}.browserVersion`, '브라우저 판');
    requireValue(blockers, row.osVersion, `${at}.osVersion`, '운영체제 판');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
    checkRows(blockers, row.flows, BROWSER_FLOWS, `${at}.flows`, (flow, flowAt) => {
      if (flow.status !== 'passed') blockers.push({ at: `${flowAt}.status`, message: '핵심 흐름이 통과 상태가 아니다' });
      if (flow.skipped !== 0) blockers.push({ at: `${flowAt}.skipped`, message: '핵심 흐름은 건너뜀 0건이어야 한다' });
      requireValue(blockers, flow.observed, `${flowAt}.observed`, '관찰 결과');
      requireEvidence(blockers, flow.evidence, `${flowAt}.evidence`);
    });
  });

  checkRows(blockers, doc.assistiveTechnology, ASSISTIVE_CASES, 'assistiveTechnology', (row, at) => {
    if (row.status !== 'passed') blockers.push({ at: `${at}.status`, message: '보조기기 검사가 통과 상태가 아니다' });
    if (row.skipped !== 0) blockers.push({ at: `${at}.skipped`, message: '보조기기 검사는 건너뜀 0건이어야 한다' });
    requireValue(blockers, row.product, `${at}.product`, '보조기기·기능 이름');
    requireValue(blockers, row.version, `${at}.version`, '보조기기·운영체제 판');
    requireValue(blockers, row.observed, `${at}.observed`, '관찰 결과');
    requireEvidence(blockers, row.evidence, `${at}.evidence`);
  });

  if (doc.defects?.blocking !== 0) blockers.push({ at: 'defects.blocking', message: '접수를 막는 접근성 결함이 남아 있다' });
  if (doc.defects?.major !== 0) blockers.push({ at: 'defects.major', message: '중대 접근성 결함이 남아 있다' });
  if (!Number.isInteger(doc.defects?.minor) || doc.defects.minor < 0) blockers.push({ at: 'defects.minor', message: '경미 결함 수가 기록되지 않았다' });
  requireValue(blockers, doc.defects?.disposition, 'defects.disposition', '발견 결함 처리 결과');
  requireEvidence(blockers, doc.defects?.evidence, 'defects.evidence');

  if (doc.finalDecision?.status !== 'approved') blockers.push({ at: 'finalDecision.status', message: '접근성 수용 승인이 없다' });
  requireValue(blockers, doc.finalDecision?.approvedAt, 'finalDecision.approvedAt', '승인 시각');
  requireValue(blockers, doc.finalDecision?.approvedBy, 'finalDecision.approvedBy', '승인자');
  requireEvidence(blockers, doc.finalDecision?.evidence, 'finalDecision.evidence');

  const browserRows = list(doc.browsers);
  const assistiveRows = list(doc.assistiveTechnology);
  return {
    passed: blockers.length === 0,
    blockers,
    summary: {
      browsers: `${BROWSER_CASES.filter((id) => browserRows.some((row) => row?.id === id && row?.status === 'passed' && row?.skipped === 0)).length}/${BROWSER_CASES.length}`,
      browserFlows: `${browserRows.reduce((sum, row) => sum + list(row?.flows).filter((flow) => flow?.status === 'passed' && flow?.skipped === 0).length, 0)}/${BROWSER_CASES.length * BROWSER_FLOWS.length}`,
      assistiveTechnology: `${ASSISTIVE_CASES.filter((id) => assistiveRows.some((row) => row?.id === id && row?.status === 'passed' && row?.skipped === 0)).length}/${ASSISTIVE_CASES.length}`,
      skipped: [...browserRows, ...browserRows.flatMap((row) => list(row?.flows)), ...assistiveRows]
        .reduce((sum, row) => sum + (Number.isInteger(row?.skipped) && row.skipped >= 0 ? row.skipped : 0), 0),
    },
  };
}

function cli() {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  if (!fileArg) {
    console.error('사용: node scripts/ops/manual-accessibility-acceptance.mjs --file=deploy/pilot/<대학>-manual-a11y.yaml [--no-write]');
    process.exit(2);
  }
  const absolute = path.resolve(ROOT, fileArg);
  const document = parse(readFileSync(absolute, 'utf8'));
  const validation = validateManualAccessibilityAcceptance(document);
  const result = {
    test: '실물 브라우저·수동 접근성 수용 증적 게이트 (T-M5-47·48)',
    at: new Date().toISOString(), source: path.relative(ROOT, absolute).replaceAll('\\', '/'),
    universityId: document?.metadata?.universityId ?? null, ...validation,
  };
  console.log(`${result.passed ? '✔' : '✘'} 수동 접근성 ${result.universityId ?? '(대학 없음)'}`);
  console.log(`  브라우저 ${result.summary.browsers}, 핵심 흐름 ${result.summary.browserFlows}, 보조기기 ${result.summary.assistiveTechnology}, 건너뜀 ${result.summary.skipped}`);
  for (const blocker of result.blockers) console.log(`  - ${blocker.at}: ${blocker.message}`);
  if (!process.argv.includes('--no-write')) {
    const dir = path.join(ROOT, 'tests/a11y/results');
    mkdirSync(dir, { recursive: true });
    const slug = `${result.universityId ?? 'unknown'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const out = path.join(dir, `manual-accessibility-acceptance-${slug}-${result.at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  결과: ${path.relative(ROOT, out)}`);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
