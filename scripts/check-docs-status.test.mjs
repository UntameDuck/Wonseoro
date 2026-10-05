import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareMilestones,
  extractMilestones,
  extractStatus,
  validateMilestoneTotal,
  validateStatuses,
} from './check-docs-status.mjs';

test('태스크 단어가 있거나 없는 상태 요약을 읽는다', () => {
  assert.deepEqual(extractStatus('전체 **146개 태스크 중 125개 완료, 21개 남음**'), {
    total: 146, completed: 125, remaining: 21,
  });
  assert.deepEqual(extractStatus('**146개 중 125개 완료, 21개 남음**'), {
    total: 146, completed: 125, remaining: 21,
  });
});

test('상태 요약이 없거나 둘이면 거절한다', () => {
  assert.throws(() => extractStatus('상태 없음'), /정확히 하나/);
  assert.throws(() => extractStatus('**2개 중 1개 완료, 1개 남음**\n**2개 중 2개 완료, 0개 남음**'), /현재 2개/);
});

test('전체가 완료와 잔여의 합이 아니면 거절한다', () => {
  assert.throws(() => validateStatuses([
    { label: 'a', status: { total: 10, completed: 8, remaining: 1 } },
    { label: 'b', status: { total: 10, completed: 8, remaining: 2 } },
  ]), /전체 10 != 완료 8 \+ 잔여 1/);
});

test('문서끼리 상태가 다르면 거절하고 같으면 통과한다', () => {
  const current = { total: 146, completed: 125, remaining: 21 };
  assert.deepEqual(validateStatuses([
    { label: 'a', status: current },
    { label: 'b', status: { ...current } },
  ]), current);
  assert.throws(() => validateStatuses([
    { label: 'a', status: current },
    { label: 'b', status: { total: 146, completed: 126, remaining: 20 } },
  ]), /b:/);
});

test('마일스톤 표를 읽고 중복 행을 거절한다', () => {
  const table = '| M0 기반 | 7/8 |\n| M1 접수 | **14/14** |';
  assert.deepEqual(extractMilestones(table), [
    { label: 'M0', completed: 7, total: 8 },
    { label: 'M1', completed: 14, total: 14 },
  ]);
  assert.throws(() => extractMilestones(`${table}\n| M1 중복 | 14/14 |`), /중복/);
});

test('마일스톤 합계와 전체 상태를 대조한다', () => {
  const milestones = [{ label: 'M0', completed: 7, total: 8 }];
  assert.deepEqual(validateMilestoneTotal(milestones, { completed: 7, total: 8 }, 'a'), { completed: 7, total: 8 });
  assert.throws(() => validateMilestoneTotal(milestones, { completed: 8, total: 8 }, 'a'), /마일스톤 합/);
});

test('묶은 마일스톤을 개별 단계 합계와 대조한다', () => {
  const reference = [
    { label: 'M0', completed: 7, total: 8 },
    { label: 'M1', completed: 14, total: 14 },
    { label: 'M2', completed: 24, total: 24 },
  ];
  assert.doesNotThrow(() => compareMilestones(reference, [
    reference[0],
    { label: 'M1~M2', completed: 38, total: 38 },
  ]));
  assert.throws(() => compareMilestones(reference, [
    reference[0],
    { label: 'M1~M2', completed: 37, total: 38 },
  ]), /기준 38\/38/);
  assert.throws(() => compareMilestones(reference, [reference[0]]), /일부가 빠졌습니다/);
});
