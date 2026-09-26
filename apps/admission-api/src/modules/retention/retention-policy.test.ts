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

  it('빠진 항목을 기본값으로 채우지 않는다 — 명시해야 한다', () => {
    const { DOCUMENT_FILE: _omit, ...rest } = VALID_RETENTION;
    assert.deepEqual(codes(rest), ['DOCUMENT_FILE']);
  });

  it('감사 기록·적용 기록에는 보존기간을 정할 수 없다', () => {
    assert.deepEqual(
      codes({ ...VALID_RETENTION, AUDIT_EVENT: { days: 3650 }, ACTIVATION_RECORD: { days: 3650 } }),
      ['AUDIT_EVENT', 'ACTIVATION_RECORD'],
    );
  });

  it('모르는 데이터 종류와 잘못된 값은 거절한다', () => {
    assert.ok(codes({ ...VALID_RETENTION, CHAT_LOG: { days: 30 } }).includes('CHAT_LOG'));
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE: { days: 0 } }).includes('DOCUMENT_FILE'));
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE: { days: 1.5 } }).includes('DOCUMENT_FILE'));
    // 일 대신 초를 넣는 식의 단위 착각.
    assert.ok(codes({ ...VALID_RETENTION, DOCUMENT_FILE: { days: 31_536_000 } }).includes('DOCUMENT_FILE'));
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
    // 법정 미달 1 + 불변 1 + 누락 6
    assert.equal(problems.length, 8);
  });
});

describe('보존기간 변경의 위험도 (Diff)', () => {
  it('줄이면 파기가 앞당겨진다 — DESTRUCTIVE', () => {
    const diff = diffConfig(
      { retention: VALID_RETENTION },
      { retention: { ...VALID_RETENTION, DOCUMENT_FILE: { days: 180 } } },
    );
    assert.equal(diff.destructive.length, 1);
    assert.equal(diff.destructive[0]!.path, 'retention.DOCUMENT_FILE.days');
  });

  it('늘리는 것은 되돌릴 수 있다 — INFO', () => {
    const diff = diffConfig(
      { retention: VALID_RETENTION },
      { retention: { ...VALID_RETENTION, DOCUMENT_FILE: { days: 730 } } },
    );
    assert.equal(diff.destructive.length, 0);
    assert.equal(diff.changes[0]!.risk, 'INFO');
  });

  it('보존정책을 통째로 지우는 것은 DESTRUCTIVE', () => {
    const diff = diffConfig({ retention: VALID_RETENTION, forms: {} }, { forms: {} });
    assert.equal(diff.destructive[0]!.path, 'retention');
  });
});
