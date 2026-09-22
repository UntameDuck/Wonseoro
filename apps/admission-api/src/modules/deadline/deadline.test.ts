import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeadlineMode, DeadlinePolicy } from '@wonseoro/contracts';
import { DeadlinePolicyPort } from './deadline-policy.port';
import { DeadlineService, MAX_CLOCK_OFFSET_MS } from './deadline.service';

const DEADLINE = '2026-09-11T09:00:00.000Z'; // 실제 장애일의 마감시각을 기준으로 잡는다

function serviceWith(mode: DeadlineMode): DeadlineService {
  const port = new (class extends DeadlinePolicyPort {
    async current(): Promise<DeadlinePolicy> {
      return {
        version: 'test-v1',
        mode,
        deadlineAt: DEADLINE,
        approvedBy1: 'A',
        approvedBy2: 'B',
        approvedAt: '2026-09-01T00:00:00.000Z',
        activatedAt: '2026-09-01T00:00:00.000Z',
        policyHash: 'test-hash',
      };
    }
  })();
  return new DeadlineService(port);
}

const at = (iso: string) => new Date(iso);

describe('마감 경계값 (v1.1 §A2 — 마감 전후 ±5초)', () => {
  const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');

  it('마감 5초 전 커밋은 통과한다', async () => {
    await assert.doesNotReject(
      svc.assertWithinDeadline('c1', {
        requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
        commitAt: at('2026-09-11T08:59:55.000Z'),
      }),
    );
  });

  it('마감 정각 커밋은 통과한다 (이하 포함)', async () => {
    await assert.doesNotReject(
      svc.assertWithinDeadline('c1', {
        requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
        commitAt: at(DEADLINE),
      }),
    );
  });

  it('마감 1ms 후 커밋은 거부한다', async () => {
    await assert.rejects(
      svc.assertWithinDeadline('c1', {
        requestReceivedAt: at('2026-09-11T08:59:50.000Z'),
        commitAt: at('2026-09-11T09:00:00.001Z'),
      }),
      (err: { problem?: { status: number; type: string } }) =>
        err.problem?.status === 409 && err.problem.type.endsWith('/deadline-passed'),
    );
  });

  it('마감 초과 응답에는 serverTime·deadlineAt·deadlinePolicyVersion·code 가 실린다', async () => {
    await svc
      .assertWithinDeadline('c1', {
        requestReceivedAt: at('2026-09-11T09:00:05.000Z'),
        commitAt: at('2026-09-11T09:00:05.000Z'),
      })
      .then(
        () => assert.fail('거부되어야 한다'),
        (err: { problem: Record<string, unknown> }) => {
          assert.ok(err.problem.serverTime, 'serverTime 필요');
          assert.equal(err.problem.deadlineAt, DEADLINE);
          assert.equal(err.problem.deadlinePolicyVersion, 'test-v1');
          assert.equal(err.problem.code, 'DEADLINE_PASSED');
        },
      );
  });
});

describe('정책 mode 별 인정 시각 (v1.1 §A2)', () => {
  const input = {
    requestReceivedAt: at('2026-09-11T08:59:58.000Z'), // 마감 전 도착
    paymentApprovedAt: at('2026-09-11T08:59:59.000Z'), // 마감 전 승인
    commitAt: at('2026-09-11T09:00:30.000Z'), // 커밋은 마감 후
  };

  it('기본 정책은 커밋 시각을 본다 — 이 경우 거부', async () => {
    const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');
    await assert.rejects(svc.assertWithinDeadline('c1', input));
  });

  it('요청 수신 기준 정책이면 통과한다', async () => {
    const svc = serviceWith('REQUEST_RECEIVED_BEFORE_DEADLINE');
    await assert.doesNotReject(svc.assertWithinDeadline('c1', input));
  });

  it('PG 승인 기준 정책이면 통과한다', async () => {
    const svc = serviceWith('PAYMENT_APPROVED_BEFORE_DEADLINE');
    await assert.doesNotReject(svc.assertWithinDeadline('c1', input));
  });

  it('PG 승인 시각이 없으면 커밋 시각으로 떨어뜨린다 — 없는 시각을 추정하지 않는다', async () => {
    const svc = serviceWith('PAYMENT_APPROVED_BEFORE_DEADLINE');
    await assert.rejects(
      svc.assertWithinDeadline('c1', {
        requestReceivedAt: input.requestReceivedAt,
        commitAt: input.commitAt,
      }),
    );
  });
});

describe('마감 스냅샷', () => {
  const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');

  it('남은 시간 7분이면 10분 경고를 준다 (30분 아님)', async () => {
    const snap = await svc.snapshot('c1', at('2026-09-11T08:53:00.000Z'));
    assert.equal(snap.warningMinutes, 10);
  });

  it('남은 시간 45분이면 경고가 없다', async () => {
    const snap = await svc.snapshot('c1', at('2026-09-11T08:15:00.000Z'));
    assert.equal(snap.warningMinutes, null);
  });

  it('남은 시간 30초면 1분 경고를 준다', async () => {
    const snap = await svc.snapshot('c1', at('2026-09-11T08:59:30.000Z'));
    assert.equal(snap.warningMinutes, 1);
  });

  it('마감 후에는 passed=true 이고 경고가 없다', async () => {
    const snap = await svc.snapshot('c1', at('2026-09-11T09:00:01.000Z'));
    assert.equal(snap.passed, true);
    assert.equal(snap.warningMinutes, null);
  });

  it('스냅샷은 OpenAPI ServerTime 필수 필드를 만족한다', async () => {
    const snap = await svc.snapshot('c1', at('2026-09-11T08:00:00.000Z'));
    // required: [serverTime, deadlineAt, deadlinePolicyVersion]
    assert.ok(snap.serverTime);
    assert.equal(snap.deadlineAt, DEADLINE);
    assert.equal(snap.deadlinePolicyVersion, 'test-v1');
  });
});

describe('Clock drift (v1.1 §A9)', () => {
  const svc = serviceWith('FINALIZED_COMMIT_BEFORE_DEADLINE');

  it('허용 오차 이내면 통과한다', () => {
    assert.doesNotThrow(() => svc.assertClockHealthy(MAX_CLOCK_OFFSET_MS - 1));
  });

  it('허용 오차를 넘으면 이 노드에서 처리하지 않는다', () => {
    assert.throws(() => svc.assertClockHealthy(MAX_CLOCK_OFFSET_MS + 1));
    assert.throws(() => svc.assertClockHealthy(-(MAX_CLOCK_OFFSET_MS + 1)));
  });
});
