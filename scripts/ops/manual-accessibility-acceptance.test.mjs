import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSISTIVE_CASES, BROWSER_CASES, BROWSER_FLOWS, validateManualAccessibilityAcceptance } from './manual-accessibility-acceptance.mjs';

const evidence = ['ticket://A11Y-1'];
const complete = () => ({
  metadata: { universityId: 'UNIV-A', candidateCommit: '0123456789abcdef', executedAt: '2027-01-02T03:04:05+09:00', tester: '접근성 검사자', evidence },
  browsers: BROWSER_CASES.map((id) => ({ id, status: 'passed', skipped: 0, realDevice: true, browserVersion: 'current-supported', osVersion: 'supported-os', evidence,
    flows: BROWSER_FLOWS.map((flowId) => ({ id: flowId, status: 'passed', skipped: 0, observed: '키보드·터치로 흐름 완료', evidence })) })),
  assistiveTechnology: ASSISTIVE_CASES.map((id) => ({ id, status: 'passed', skipped: 0, product: `${id} 도구`, version: '검사 판', observed: '이름·상태·오류·결과를 인지하고 조작 완료', evidence })),
  defects: { blocking: 0, major: 0, minor: 1, disposition: '경미 1건 후속 티켓에 기한·책임자 지정', evidence },
  finalDecision: { status: 'approved', approvedAt: '2027-01-03T09:00:00+09:00', approvedBy: '대학 접근성 책임자', evidence },
});

test('실물 브라우저·보조기기 전 항목과 승인이 있으면 통과한다', () => {
  const result = validateManualAccessibilityAcceptance(complete());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { browsers: '2/2', browserFlows: '12/12', assistiveTechnology: '4/4', skipped: 0 });
});

test('에뮬레이션과 건너뛴 흐름을 차단한다', () => {
  const doc = complete();
  doc.browsers[0].realDevice = false;
  doc.browsers[1].flows[0].skipped = 1;
  const paths = validateManualAccessibilityAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('browsers.firefox-windows.realDevice'));
  assert(paths.includes('browsers.safari-ios.flows.applicant-journey.skipped'));
});

test('보조기기 누락·차단 결함·미승인을 차단한다', () => {
  const doc = complete();
  doc.assistiveTechnology = doc.assistiveTechnology.filter((row) => row.id !== 'voice-input');
  doc.defects.blocking = 1;
  doc.finalDecision.status = 'pending';
  const paths = validateManualAccessibilityAcceptance(doc).blockers.map((item) => item.at);
  assert(paths.includes('assistiveTechnology.voice-input'));
  assert(paths.includes('defects.blocking'));
  assert(paths.includes('finalDecision.status'));
});
