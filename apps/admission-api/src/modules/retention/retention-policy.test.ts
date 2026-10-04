import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateRetention } from '@wonseoro/contracts';
import { diffConfig } from '../config/config-diff';
import { VALID_RETENTION } from './retention.fixture';

const codes = (input: unknown) => validateRetention(input).map((p) => p.category);

describe('보존 정책 검증 (v1.1 §A15)', () => {
  it('기준을 모두 만족하면 문제가 없다', () => {
    assert.deepEqual(validateRetention(VALID_RETENTION), []);
  });

  it('법정 기준보다 짧게 정할 수 없다 — 관리자 접속기록 2년', () => {
    const problems = validateRetention({ ...VALID_RETENTION, ADMIN_ACCESS_LOG: { days: 365 } });
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.category, 'ADMIN_ACCESS_LOG');
    assert.match(problems[0]!.message, /730/);
  });

  it('접수 원서는 10년보다 짧게 정할 수 없다 — 입시관리 기록물 (D-38)', () => {
    const problems = validateRetention({ ...VALID_RETENTION, APPLICATION_SUBMITTED: { days: 1825 } });
    assert.deepEqual(problems.map((p) => p.category), ['APPLICATION_SUBMITTED']);
    assert.match(problems[0]!.message, /3650/);
  });

  it('결제·동의 기록은 정합성 규칙으로 접수 원서의 10년을 따라간다', () => {
    const problems = validateRetention({
      ...VALID_RETENTION,
      PAYMENT_RECORD: { days: 1825 },
      CONSENT_RECORD: { days: 1825 },
    });
    // 동의 기록은 10년 하한이 걸린 개인정보 항목마다(접수 원서·접수한 지원자 신원) 문제를 낸다
    assert.deepEqual([...new Set(problems.map((p) => p.category))].sort(), ['CONSENT_RECORD', 'PAYMENT_RECORD']);
  });

  it('신원·서류는 접수·미접수로 나뉜다 — 미접수자 정보는 10년 하한에 묶이지 않는다 (문서 10 G-13, D-87)', () => {
    // 접수하지 않은 지원자의 신원·서류는 짧게 둘 수 있다
    assert.deepEqual(validateRetention({ ...VALID_RETENTION, APPLICANT_PII_UNSUBMITTED: { days: 30 }, DOCUMENT_FILE_UNSUBMITTED: { days: 30 } }), []);
    // 접수한 지원자의 신원은 접수 원서와 같은 10년 하한
    assert.deepEqual(codes({ ...VALID_RETENTION, APPLICANT_PII_SUBMITTED: { days: 1825 } }), ['APPLICANT_PII_SUBMITTED']);
    // 원서를 더 오래 두면 신원도 그만큼 — 원서가 누구의 것인지 잃지 않는다
    const longer = codes({ ...VALID_RETENTION, APPLICATION_SUBMITTED: { days: 5000 }, PAYMENT_RECORD: { days: 5000 }, CONSENT_RECORD: { days: 5000 } });
    assert.deepEqual(longer, ['APPLICANT_PII_SUBMITTED']);
    // 옛 한 항목 이름은 더는 받지 않는다 — 나눈 두 항목을 각각 명시한다
    assert.ok(codes({ ...VALID_RETENTION, APPLICANT_PII: { days: 365 } }).includes('APPLICANT_PII'));
  });

  it('빠진 항목을 기본값으로 채우지 않는다 — 명시해야 한다', () => {
    const { DOCUMENT_FILE_UNSUBMITTED: _omit, ...rest } = VALID_RETENTION;
    assert.deepEqual(codes(rest), ['DOCUMENT_FILE_UNSUBMITTED']);
  });

  it('감사 기록·적용 기록에는 보존기간을 정할 수 없다', () => {
    assert.deepEqual(
      codes({ ...VALID_RETENTION, AUDIT_EVENT: { days: 3650 }, ACTIVATION_RECORD: { days: 3650 } }),
      ['AUDIT_EVENT', 'ACTIVATION_RECORD'],
    );
  });

  it('모르는 데이터 종류와 잘못된 값은 거절한다', () => {
    assert.ok(codes({ ...VALID_RETENTION, CHAT_LOG: { days: 30 } }).includes('CHAT_LOG'));
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE_UNSUBMITTED: { days: 0 } }).includes('DOCUMENT_FILE_UNSUBMITTED'));
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE_UNSUBMITTED: { days: 1.5 } }).includes('DOCUMENT_FILE_UNSUBMITTED'));
    // 일 대신 초를 넣는 식의 단위 착각.
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE_UNSUBMITTED: { days: 31_536_000 } }).includes('DOCUMENT_FILE_UNSUBMITTED'));
    assert.deepEqual(codes([]), ['*']);
  });

  it('동의 기록은 그 동의로 처리한 데이터보다 먼저 사라지면 안 된다', () => {
    const problems = validateRetention({ ...VALID_RETENTION, CONSENT_RECORD: { days: 365 } });
    // 접수 원서·신원이 365 일보다 길다. 둘 다 알려준다. (서류는 정확히 365 일이라 괜찮다)
    assert.equal(problems.filter((p) => p.category === 'CONSENT_RECORD').length, 2);
  });

  it('결제 기록은 접수 원서보다 먼저 사라지면 안 된다 — 접수 증적이 깨진다', () => {
    assert.deepEqual(codes({ ...VALID_RETENTION, PAYMENT_RECORD: { days: 365 } }), ['PAYMENT_RECORD']);
  });

  it('문제는 한 번에 모두 알려준다', () => {
    const problems = validateRetention({
      ADMIN_ACCESS_LOG: { days: 30 },
      AUDIT_EVENT: { days: 10 },
    });
    // 법정 미달 1 + 불변 1 + 누락 9 (신원·서류를 접수·미접수로 나눠 둘, 권한 변경 기록 하나가 늘었다 — D-87·D-91)
    assert.equal(problems.length, 11);
  });

  it('권한 부여·변경·말소 기록은 3년보다 짧게 정할 수 없다 (안전성 확보조치 기준 제5조 ③, G-15·D-91)', () => {
    const problems = validateRetention({ ...VALID_RETENTION, ACCESS_GRANT_LOG: { days: 730 } });
    assert.deepEqual(problems.map((p) => p.category), ['ACCESS_GRANT_LOG']);
    assert.match(problems[0]!.message, /1095/);
  });
});

describe('보존기간 변경의 위험도 (Diff)', () => {
  it('줄이면 파기가 앞당겨진다 — DESTRUCTIVE', () => {
    const diff = diffConfig(
      { retention: VALID_RETENTION },
      { retention: { ...VALID_RETENTION, DOCUMENT_FILE_UNSUBMITTED: { days: 180 } } },
    );
    assert.equal(diff.destructive.length, 1);
    assert.equal(diff.destructive[0]!.path, 'retention.DOCUMENT_FILE_UNSUBMITTED.days');
  });

  it('늘리는 것은 되돌릴 수 있다 — INFO', () => {
    const diff = diffConfig(
      { retention: VALID_RETENTION },
      { retention: { ...VALID_RETENTION, DOCUMENT_FILE_UNSUBMITTED: { days: 730 } } },
    );
    assert.equal(diff.destructive.length, 0);
    assert.equal(diff.changes[0]!.risk, 'INFO');
  });

  it('보존정책을 통째로 지우는 것은 DESTRUCTIVE', () => {
    const diff = diffConfig({ retention: VALID_RETENTION, forms: {} }, { forms: {} });
    assert.equal(diff.destructive[0]!.path, 'retention');
  });
});
