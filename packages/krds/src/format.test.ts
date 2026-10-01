import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cycleTitle, formatDate, formatDateTime, formatTime, isoToKstInput, kstInputToIso } from './format.ts';

/** 표기 규칙 (T-M5-54) — 와이어프레임 형식, 언제나 한국 시간. 실행하는 PC 의 시간대와 무관해야 한다. */
describe('날짜·시각 표기 (T-M5-54)', () => {
  const deadline = '2026-12-31T09:00:00.000Z'; // 한국 18:00

  it('와이어프레임 형식 — 2026.12.31 18:00 · 18:00:00 · 2026.12.31', () => {
    assert.equal(formatDateTime(deadline), '2026.12.31 18:00');
    assert.equal(formatTime(deadline), '18:00:00');
    assert.equal(formatTime(deadline, { seconds: false }), '18:00');
    assert.equal(formatDate(deadline), '2026.12.31');
  });

  it('한국 날짜가 넘어가는 시각 — UTC 15시는 다음 날 0시', () => {
    assert.equal(formatDateTime('2026-09-30T15:30:00Z'), '2026.10.01 00:30');
  });

  it('값이 없거나 깨졌으면 "-"', () => {
    assert.equal(formatDateTime(null), '-');
    assert.equal(formatDateTime(''), '-');
    assert.equal(formatDateTime('not-a-date'), '-');
  });

  it('모집 이름에 학년도가 있으면 다시 붙이지 않는다 (U-18)', () => {
    assert.equal(cycleTitle(2027, '2027 수시'), '2027 수시');
    assert.equal(cycleTitle(2027, '수시모집'), '2027학년도 수시모집');
    assert.equal(cycleTitle(2027, '2027학년도 정시'), '2027학년도 정시');
  });

  it('마감 입력은 한국 시간으로 읽는다 — PC 시간대와 무관 (U-47)', () => {
    assert.equal(kstInputToIso('2026-12-31T18:00'), '2026-12-31T09:00:00.000Z');
    assert.equal(isoToKstInput('2026-12-31T09:00:00.000Z'), '2026-12-31T18:00');
    assert.equal(kstInputToIso('2026-12-31'), null);
  });
});
