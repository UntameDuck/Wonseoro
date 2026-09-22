import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApplicationStateService } from './application-state.service';

const svc = new ApplicationStateService();

describe('Application 상태머신 (v1.0 §5.6)', () => {
  it('정상 경로 전이를 허용한다', () => {
    assert.ok(svc.can('DRAFT', 'READY'));
    assert.ok(svc.can('READY', 'PAYMENT_PENDING'));
    assert.ok(svc.can('PAYMENT_PENDING', 'PAID'));
    assert.ok(svc.can('PAID', 'FINALIZING'));
    assert.ok(svc.can('FINALIZING', 'FINALIZED'));
  });

  it('FINALIZING 에서 재시도 가능 실패로 PAID 로 돌아간다', () => {
    assert.ok(svc.can('FINALIZING', 'PAID'));
  });

  it('마감으로 EXPIRED 전이를 허용한다', () => {
    assert.ok(svc.can('DRAFT', 'EXPIRED'));
    assert.ok(svc.can('READY', 'EXPIRED'));
  });

  it('단계를 건너뛰는 전이를 거부한다', () => {
    assert.equal(svc.can('DRAFT', 'FINALIZED'), false);
    assert.equal(svc.can('DRAFT', 'PAID'), false);
    assert.equal(svc.can('READY', 'FINALIZING'), false);
  });

  it('FINALIZED 는 종착 상태다 — 어디로도 가지 않는다', () => {
    assert.ok(svc.isTerminal('FINALIZED'));
    assert.equal(svc.nextStates('FINALIZED').length, 0);
  });

  it('FINALIZED 원서 변경 시도는 409 로 거부한다', () => {
    assert.throws(
      () => svc.assertCan('FINALIZED', 'DRAFT'),
      (err: { problem?: { status: number } }) => err.problem?.status === 409,
    );
  });

  it('EXPIRED 도 종착 상태다', () => {
    assert.ok(svc.isTerminal('EXPIRED'));
  });

  it('업무필드 수정은 DRAFT/READY 에서만 허용한다', () => {
    assert.ok(svc.isEditable('DRAFT'));
    assert.ok(svc.isEditable('READY'));
    assert.equal(svc.isEditable('PAID'), false);
    assert.equal(svc.isEditable('FINALIZED'), false);
  });
});

describe('조건부 전이 (v1.1 §B3 — 읽고-검사하고-쓰기 금지)', () => {
  it('기대 상태와 기대 버전을 함께 담는다', () => {
    const plan = svc.plan('app-1', 'PAID', 7n, 'FINALIZING');
    assert.equal(plan.expectedStatus, 'PAID');
    assert.equal(plan.expectedVersion, 7n);
    assert.equal(plan.nextStatus, 'FINALIZING');
  });

  it('허용되지 않은 전이는 계획 단계에서 막는다', () => {
    assert.throws(() => svc.plan('app-1', 'DRAFT', 1n, 'FINALIZED'));
  });

  it('UPDATE 가 0건이면 409 로 해석한다 — 다른 요청이 먼저 바꾼 것', () => {
    const plan = svc.plan('app-1', 'PAID', 7n, 'FINALIZING');
    assert.throws(
      () => svc.assertApplied(0, plan),
      (err: { problem?: { status: number } }) => err.problem?.status === 409,
    );
  });

  it('UPDATE 가 1건이면 통과한다', () => {
    const plan = svc.plan('app-1', 'PAID', 7n, 'FINALIZING');
    assert.doesNotThrow(() => svc.assertApplied(1, plan));
  });
});
