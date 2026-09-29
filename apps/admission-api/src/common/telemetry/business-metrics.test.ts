import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { ProblemException } from '../problem/problem.exception';
import {
  classifyFailure,
  trackDraftSave,
  trackFinalize,
  trackPaymentVerify,
} from './business-metrics';

describe('업무 KPI 결과 분류 (T-M4-22)', () => {
  it('업무 검증 거절(4xx)은 시스템 실패가 아니다 — 성공률 분모에서 빠진다', () => {
    assert.equal(classifyFailure(ProblemException.validationFailed('필수값')), 'rejected');
    assert.equal(classifyFailure(new HttpException('not found', 404)), 'rejected');
  });

  it('If-Match 불일치·경합은 충돌로 센다', () => {
    assert.equal(classifyFailure(new HttpException('precondition', 412)), 'conflict');
    assert.equal(classifyFailure(new HttpException('conflict', 409)), 'conflict');
  });

  it('5xx·예상 밖 예외는 오류다', () => {
    assert.equal(classifyFailure(new HttpException('boom', 503)), 'error');
    assert.equal(classifyFailure(new Error('db down')), 'error');
  });

  it('추적 래퍼는 결과·예외를 그대로 넘긴다', async () => {
    assert.equal(await trackDraftSave(async () => 7), 7);
    await assert.rejects(trackDraftSave(async () => { throw new Error('x'); }), /x/);

    const finalized = await trackFinalize('applicant', async () => ({ created: false, id: 1 }));
    assert.deepEqual(finalized, { created: false, id: 1 });

    const row = await trackPaymentVerify(async () => ({ row: { status: 'CONFIRMED' }, unverified: false }));
    assert.equal(row.status, 'CONFIRMED');
  });
});
