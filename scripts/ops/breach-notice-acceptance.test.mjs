import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import { validateBreachNotice } from './breach-notice-acceptance.mjs';
import { assess, sensitiveConsentCodes } from './breach-scope.mjs';

/** 개인정보 유출등 통지·신고 (제34조, 시행령 제39·40조, G-14·D-92) */
const valid = () => ({
  metadata: { universityId: 'UNIV-A', incidentId: 'BR-2026-001', privacyOfficer: '입학처장(개인정보 보호책임자)' },
  discovery: {
    discoveredAt: '2026-10-05T09:00:00+09:00',
    occurredFrom: '2026-10-04T22:00:00+09:00',
    occurredTo: '2026-10-05T08:30:00+09:00',
    route: '담당자 계정 탈취',
    externalIntrusion: true,
    scope: { applicants: 11, sensitive: false, uniqueIdentifier: false, evidence: ['breach-scope-BR-2026-001.json'] },
  },
  containment: { actions: ['탈취 계정 사용 중지·역할 회수', '세션 강제 종료'], evidence: ['access-grant-log seq 812'] },
  notification: {
    method: 'written',
    sentAt: '2026-10-06T20:00:00+09:00',
    recipients: 11,
    items: {
      leakedItems: '성명·연락처·출신 고교',
      whenAndHow: '10월 4일 22시부터 다음 날 8시 30분 사이 담당자 계정 도용으로 열람',
      selfProtection: '출처를 알 수 없는 연락에 응하지 않기',
      responseAndRemedy: '계정 사용 중지, 접속 경로 차단, 피해 구제 신청 안내',
      contactDepartment: '입학처 개인정보 담당 02-000-0000',
      legalRights: '손해배상·법정손해배상 청구, 개인정보 분쟁조정 신청',
    },
    evidence: ['notice-mail-log'],
  },
  report: { status: 'sent', agency: 'KISA', reportedAt: '2026-10-06T10:00:00+09:00', evidence: ['report-receipt'] },
  finalDecision: { status: 'approved', approvedBy: '입학처장', approvedAt: '2026-10-07T09:00:00+09:00' },
});
const at = (r) => r.blockers.map((b) => b.at);

describe('유출 통지·신고 게이트', () => {
  it('72시간 안 통지 6개 항목·외부 침입 신고 — 통과', () => {
    const r = validateBreachNotice(valid());
    assert.deepEqual(r.blockers, []);
    assert.equal(r.passed, true);
    assert.equal(r.summary.noticeHours, 35);
    assert.deepEqual(r.summary.reportReasons, ['외부 불법 접근']);
    assert.equal(r.summary.deadline, '2026-10-08T00:00:00.000Z');
  });

  it('빈 시작 양식은 실패한다', () => {
    const r = validateBreachNotice(parse(readFileSync(new URL('../../deploy/pilot/breach-notice.example.yaml', import.meta.url), 'utf8')));
    assert.equal(r.passed, false);
    assert.ok(r.blockers.length >= 10);
  });

  it('72시간을 넘긴 통지는 사유와 해소 시각이 있어야 하고, 있으면 경고로 사람에게 넘긴다', () => {
    const late = valid();
    late.notification.sentAt = '2026-10-08T12:00:00+09:00';
    assert.ok(at(validateBreachNotice(late)).includes('notification.sentAt'));
    late.notification.delay = { reason: 'urgent-containment', resolvedAt: '2026-10-08T10:00:00+09:00', evidence: ['차단 작업 기록'] };
    const r = validateBreachNotice(late);
    assert.deepEqual(r.blockers, []);
    assert.ok(r.warnings.some((w) => w.at === 'notification.delay'));
  });

  it('통지 항목이 비면 실패 — 1·2호는 pending 이면 확인된 내용과 추가 통지가 있어야 한다', () => {
    const missing = valid();
    missing.notification.items.legalRights = '';
    assert.deepEqual(at(validateBreachNotice(missing)), ['notification.items.legalRights']);

    const partial = valid();
    partial.notification.items.leakedItems = 'pending';
    const r1 = validateBreachNotice(partial);
    assert.ok(at(r1).includes('notification.confirmedSoFar'));
    assert.ok(at(r1).includes('notification.followUps.leakedItems'));
    assert.ok(at(r1).includes('report.followUps'));
    partial.notification.confirmedSoFar = '담당자 계정으로 원서 11건이 열람된 사실';
    partial.notification.followUps = [{ at: '2026-10-07T10:00:00+09:00', items: ['leakedItems'] }];
    partial.report.followUps = [{ at: '2026-10-07T10:30:00+09:00' }];
    assert.deepEqual(validateBreachNotice(partial).blockers, []);
  });

  it('신고 대상(1천 명 이상·민감·고유식별·외부 침입)인데 신고가 없으면 실패, 생략은 근거가 있을 때만', () => {
    const big = valid();
    big.discovery.externalIntrusion = false;
    big.discovery.scope.applicants = 1200;
    big.notification.recipients = 1200;
    big.report = { status: 'not-required' };
    assert.ok(at(validateBreachNotice(big)).includes('report.status'));
    big.report = { status: 'exempted', exemption: { reason: '유출본 회수·삭제 확인', evidence: ['회수 확인서'] } };
    const r = validateBreachNotice(big);
    assert.deepEqual(r.blockers, []);
    assert.ok(r.warnings.some((w) => w.at === 'report.exemption'));

    const late = valid();
    late.report.reportedAt = '2026-10-09T10:00:00+09:00';
    assert.ok(at(validateBreachNotice(late)).includes('report.reportedAt'));
    const wrong = valid();
    wrong.report.agency = '경찰';
    assert.ok(at(validateBreachNotice(wrong)).includes('report.agency'));
  });

  it('신고 대상이 아니면 신고 없이 통과 — 통지 받은 수가 모자라면 실패, 게시 갈음은 30일 이상', () => {
    const small = valid();
    small.discovery.externalIntrusion = false;
    small.report = { status: 'not-required' };
    assert.deepEqual(validateBreachNotice(small).blockers, []);
    small.notification.recipients = 5;
    assert.ok(at(validateBreachNotice(small)).includes('notification.recipients'));
    small.notification.method = 'substitute';
    small.notification.substitute = { reason: '연락처를 알 수 없음', postedFrom: '2026-10-06T00:00:00+09:00', postedUntil: '2026-10-20T00:00:00+09:00' };
    assert.ok(at(validateBreachNotice(small)).includes('notification.substitute'));
    small.notification.substitute.postedUntil = '2026-11-06T00:00:00+09:00';
    assert.deepEqual(validateBreachNotice(small).blockers, []);
  });
});

describe('유출 범위 판단', () => {
  it('전형 설정에서 민감정보·고유식별 별도 동의 코드를 꺼낸다', () => {
    const codes = sensitiveConsentCodes([
      { forms: { EARLY: { sensitiveDocuments: { DISABILITY_CERT: 'SENSITIVE_HEALTH' }, schema: { properties: { passportNumber: { 'x-sensitive-consent': 'PASSPORT_COLLECTION' } } } } } },
      { forms: { LATE: { sensitiveDocuments: { MEDICAL: 'SENSITIVE_HEALTH' } } } },
    ]);
    assert.deepEqual(codes, { sensitive: ['SENSITIVE_HEALTH'], uniqueId: ['PASSPORT_COLLECTION'] });
  });

  it('1천 명·민감·고유식별·외부 침입 중 하나면 신고, 외부 침입을 안 정했으면 미정', () => {
    const base = { applicants: 10, applications: 10, sensitiveApplications: 0, uniqueIdApplications: 0, residentIdApplicants: 0 };
    assert.equal(assess({ ...base, externalIntrusion: false }).reportRequired, false);
    assert.equal(assess(base).reportRequired, 'undecided');
    assert.equal(assess({ ...base, applicants: 1000, externalIntrusion: false }).reportRequired, true);
    assert.equal(assess({ ...base, residentIdApplicants: 1, externalIntrusion: false }).reportRequired, true);
    assert.equal(assess({ ...base, externalIntrusion: true }).reportRequired, true);
    assert.equal(assess({ ...base, discoveredAt: '2026-10-05T00:00:00.000Z' }).notifyDeadline, '2026-10-08T00:00:00.000Z');
    assert.equal(assess({ ...base, applicants: 0, applications: 0, externalIntrusion: false }).notifyRequired, false);
  });
});
