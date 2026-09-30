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

describe('Finalize 는 한 트랜잭션이다 (D-54)', () => {
  it('PAID 에서 FINALIZED 로 바로 간다 — FINALIZING 은 DB 에 남지 않는다', () => {
    assert.ok(svc.can('PAID', 'FINALIZED'));
  });

  it('그래도 작성 단계에서 접수로 건너뛰지는 못한다', () => {
    assert.equal(svc.can('DRAFT', 'FINALIZED'), false);
    assert.equal(svc.can('PAYMENT_PENDING', 'FINALIZED'), false);
  });

  it('결제가 실패하면 결제 전(READY)으로 돌아간다', () => {
    assert.ok(svc.can('PAYMENT_PENDING', 'READY'));
  });

  it('결제를 시작한 원서는 고칠 수 없다', () => {
    assert.equal(svc.isEditable('PAYMENT_PENDING'), false);
  });
});
