import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import {
  assertOverlayConsistent,
  parseSchedule,
  planPeakMode,
  renderOverlay,
} from './schedule.mjs';

const schedule = (windows, extra = '') => `university: UNIV-A\nleadMinutes: 60\n${extra}windows:\n${windows}`;
const W1 = `  - id: 2027-susi-1
    scaleOutAt: "2026-09-08T00:00:00+09:00"
    suspendJobsAt: "2026-09-09T12:00:00+09:00"
    endsAt: "2026-09-10T06:00:00+09:00"
    apiMinReplicas: 8
`;
const W2 = `  - id: 2027-jeongsi
    scaleOutAt: "2026-12-29T00:00:00+09:00"
    suspendJobsAt: "2026-12-31T12:00:00+09:00"
    endsAt: "2027-01-01T06:00:00+09:00"
`;
const at = (text) => Date.parse(text);

describe('Peak Mode 예약 → desired state (T-M4-07, D-48)', () => {
  const parsed = parseSchedule(schedule(W2 + W1), 'UNIV-A');

  it('창을 시작 순으로 정렬한다', () => {
    assert.deepEqual(parsed.windows.map((w) => w.id), ['2027-susi-1', '2027-jeongsi']);
  });

  it('선행 시간만큼 앞당겨 켜고, 종료는 앞당기지 않는다', () => {
    assert.equal(planPeakMode(parsed, at('2026-09-07T22:59:59+09:00')).active, false);
    assert.equal(planPeakMode(parsed, at('2026-09-07T23:00:00+09:00')).window.id, '2027-susi-1');
    assert.equal(planPeakMode(parsed, at('2026-09-10T05:59:59+09:00')).window.id, '2027-susi-1');
    assert.equal(planPeakMode(parsed, at('2026-09-10T06:00:00+09:00')).active, false);
    assert.equal(planPeakMode(parsed, at('2026-12-30T12:00:00+09:00')).window.id, '2027-jeongsi');
  });

  it('활성 overlay 는 확장·억제 시각·종료 시각을 차트 values 로 낸다', () => {
    const overlay = renderOverlay(parsed, planPeakMode(parsed, at('2026-09-09T00:00:00+09:00')));
    assert.deepEqual(parse(overlay).peakMode, {
      enabled: true,
      window: '2027-susi-1',
      scheduledActivation: '2026-09-09T12:00:00+09:00',
      scheduledEnd: '2026-09-10T06:00:00+09:00',
      apiMinReplicas: 8,
    });
  });

  it('평시 overlay 는 첨부 예시 예약 시각을 비운다 — 지난 시각이 영구 억제로 남지 않게', () => {
    const overlay = renderOverlay(parsed, planPeakMode(parsed, at('2026-10-01T00:00:00Z')));
    assert.deepEqual(parse(overlay).peakMode, {
      enabled: false, window: '', scheduledActivation: '', scheduledEnd: '',
    });
  });

  it('같은 계획이면 같은 바이트 — 예약이 그대로면 커밋이 생기지 않는다', () => {
    const now = at('2026-09-09T00:00:00+09:00');
    assert.equal(renderOverlay(parsed, planPeakMode(parsed, now)), renderOverlay(parsed, planPeakMode(parsed, now + 3_600_000)));
  });

  it('CI 는 평시·예약된 창 overlay 를 받고 손으로 고친 overlay 는 거부한다', () => {
    const active = renderOverlay(parsed, planPeakMode(parsed, at('2026-09-09T00:00:00+09:00')));
    assert.equal(assertOverlayConsistent(parsed, active), '2027-susi-1');
    assert.equal(assertOverlayConsistent(parsed, renderOverlay(parsed, { active: false, window: null })), null);
    assert.throws(() => assertOverlayConsistent(parsed, active.replace('apiMinReplicas: 8', 'apiMinReplicas: 80')), /손으로/);
    assert.throws(() => assertOverlayConsistent(parsed, active.replaceAll('2027-susi-1', '2027-susi-9')), /예약에 없다/);
  });

  it('잘못된 예약은 실패한다', () => {
    assert.throws(() => parseSchedule(schedule(W1), 'UNIV-B'), /경로의 UNIV-B/);
    assert.throws(() => parseSchedule(schedule(W1.replace('+09:00"\n    suspend', '"\n    suspend'))), /RFC3339/);
    assert.throws(() => parseSchedule(schedule(W1.replace('2026-09-09T12', '2026-09-07T12'))), /사전 확장이/);
    assert.throws(() => parseSchedule(schedule(W1.replace('2026-09-10T06', '2026-09-09T11'))), /종료보다/);
    assert.throws(() => parseSchedule(schedule(W1.replace('2026-09-10T06', '2026-09-30T06'))), /14일/);
    assert.throws(() => parseSchedule(schedule(W1 + W1.replace('2027-susi-1', 'dup'))), /겹친다/);
    assert.throws(() => parseSchedule(schedule(W1.replace('apiMinReplicas: 8', 'apiMinReplicas: 0'))), /1~100/);
    assert.throws(() => parseSchedule(schedule(W1.replace('apiMinReplicas', 'deadline'))), /알 수 없는 키/);
  });

  it('창 사이가 선행 시간보다 가까우면 겹침으로 본다', () => {
    // 앞 창 종료 30분 뒤 시작 — 선행 60분을 빼면 앞 창 안에서 켜져야 한다
    const near = `  - id: next
    scaleOutAt: "2026-09-10T06:30:00+09:00"
    suspendJobsAt: "2026-09-11T12:00:00+09:00"
    endsAt: "2026-09-12T06:00:00+09:00"
`;
    assert.throws(() => parseSchedule(schedule(W1 + near)), /겹친다/);
    assert.doesNotThrow(() => parseSchedule(schedule(W1 + near.replace('06:30:00', '07:00:00'))));
  });

  it('빈 예약은 평시다', () => {
    const empty = parseSchedule('university: UNIV-A\nwindows: []\n', 'UNIV-A');
    assert.equal(empty.leadMinutes, 60);
    assert.equal(planPeakMode(empty, Date.now()).active, false);
  });
});
