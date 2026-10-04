import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALENDAR_WINDOWS,
  COMPLIANCE_DOMAINS,
  INCIDENT_ROLES,
  REQUIRED_TESTS,
  SHADOW_STAGES,
  WAR_ROOM_INJECTS,
  validatePilotReadiness,
} from './pilot-readiness.mjs';

const evidence = ['ticket://OPS-1'];
const complete = () => ({
  metadata: { universityId: 'UNIV-A', admissionCycle: '2027-early', targetStartDate: '2027-09-01', ownerOrganization: 'A대학교' },
  runbook: {
    status: 'approved', approvedAt: '2027-01-02T03:04:05+09:00', evidence,
    roles: INCIDENT_ROLES.map((id) => ({ id, owner: `${id} 담당`, backupOwner: `${id} 대체`, contactRef: `vault://contacts/${id}` })),
  },
  calendar: CALENDAR_WINDOWS.map((id) => ({ id, status: 'completed', owner: '운영 책임자', evidence })),
  warRoom: {
    status: 'completed', heldAt: '2027-08-25T10:00:00+09:00', incidentCommander: '훈련 IC', evidence,
    injects: WAR_ROOM_INJECTS.map((id) => ({ id, status: 'observed', result: '예상 흐름 확인', evidence })),
  },
  privacyImpact: { decision: 'required', status: 'approved', basis: '기관 사전판정서', approvedAt: '2027-01-03T09:00:00+09:00', evidence },
  tests: REQUIRED_TESTS.map((id) => ({ id, status: 'passed', environment: 'pilot-staging', executedAt: '2027-08-20T09:00:00+09:00', skipped: 0, evidence })),
  compliance: COMPLIANCE_DOMAINS.map((id) => ({ id, verdict: 'compliant', owner: '통제 책임자', basis: '기관 적용표', evidence })),
  shadowTest: {
    stages: SHADOW_STAGES.map((id) => ({ id, status: 'completed', approvedBy: '대학 승인자', completedAt: '2027-08-28T09:00:00+09:00', evidence })),
    feedbackDisposition: '피드백 3건 반영 및 재검증', evidence,
  },
});

test('모든 승인·실행 증적이 있으면 Pilot 진입을 통과한다', () => {
  const result = validatePilotReadiness(complete());
  assert.equal(result.passed, true, JSON.stringify(result.blockers, null, 2));
  assert.deepEqual(result.summary, { calendar: '9/9', tests: '18/18', compliance: '10/10', shadowStages: '3/3' });
});

test('건너뜀 수 자체는 허용하되 반드시 숫자로 기록한다', () => {
  const doc = complete();
  doc.tests[0].skipped = 3;
  assert.equal(validatePilotReadiness(doc).passed, true);
  delete doc.tests[0].skipped;
  assert.match(validatePilotReadiness(doc).blockers.map((item) => item.at).join('\n'), /tests\.unit\.skipped/);
});

test('누락·중복·미완료·자리표시자를 모두 차단한다', () => {
  const doc = complete();
  doc.calendar = doc.calendar.filter((row) => row.id !== 'd-14~7');
  doc.tests.push({ ...doc.tests[0] });
  doc.compliance[0].verdict = 'pending';
  doc.runbook.roles[0].contactRef = '미정';
  doc.shadowTest.stages[0].evidence = [];
  const result = validatePilotReadiness(doc);
  assert.equal(result.passed, false);
  const paths = result.blockers.map((item) => item.at);
  assert(paths.includes('calendar.d-14~7'));
  assert(paths.includes('tests.unit'));
  assert(paths.includes('compliance.krds.verdict'));
  assert(paths.includes('runbook.roles.incident-commander.contactRef'));
  assert(paths.includes('shadowTest.stages.sandbox.evidence'));
});
