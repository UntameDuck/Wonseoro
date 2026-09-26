import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitStateChange,
  DependencyFailure,
  httpServerError,
} from './circuit-breaker';

/** 시계를 손으로 돌린다. 실제 시간을 기다리는 시험은 느리고 흔들린다. */
function harness(threshold = 3, openMs = 1000) {
  let t = 0;
  const changes: CircuitStateChange[] = [];
  const breaker = new CircuitBreaker({
    name: 'central',
    failureThreshold: threshold,
    openMs,
    now: () => t,
    onStateChange: (c) => changes.push(c),
  });
  return {
    breaker,
    changes,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const ok = () => Promise.resolve('ok');
const down = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

async function failTimes(breaker: CircuitBreaker, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await assert.rejects(breaker.run(down));
  }
}

describe('CircuitBreaker', () => {
  it('연속 실패가 threshold 에 닿기 전에는 열리지 않는다', async () => {
    const { breaker } = harness(3);
    await failTimes(breaker, 2);
    assert.equal(breaker.state, 'CLOSED');
    assert.equal(breaker.allowsRequest(), true);
  });

  it('성공이 끼면 연속 실패를 다시 센다', async () => {
    const { breaker } = harness(3);
    await failTimes(breaker, 2);
    await breaker.run(ok);
    await failTimes(breaker, 2);
    assert.equal(breaker.state, 'CLOSED');
  });

  it('threshold 번 연속 실패하면 열리고, 열린 뒤에는 호출하지 않는다', async () => {
    const { breaker } = harness(3);
    await failTimes(breaker, 3);
    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.snapshot().lastFailure, 'ECONNREFUSED');

    let called = false;
    await assert.rejects(
      breaker.run(async () => {
        called = true;
        return 'x';
      }),
      (err: unknown) => err instanceof CircuitOpenError && err.retryAfterMs === 1000,
    );
    assert.equal(called, false, '열린 회로는 의존성에 닿지 않아야 한다 — 그게 대기를 없애는 방법이다');
    assert.equal(breaker.allowsRequest(), false);
  });

  it('대기가 끝나면 반열림이 되고 탐침은 한 건만 통과한다', async () => {
    const { breaker, advance } = harness(2, 1000);
    await failTimes(breaker, 2);
    advance(1000);
    assert.equal(breaker.state, 'HALF_OPEN');

    let release!: () => void;
    const probe = breaker.run(
      () =>
        new Promise<string>((r) => {
          release = () => r('ok');
        }),
    );
    // 탐침이 도는 동안 다른 호출은 막는다. 막 살아난 의존성에 몰리면 다시 쓰러진다.
    assert.equal(breaker.allowsRequest(), false);
    await assert.rejects(breaker.run(ok), CircuitOpenError);

    release();
    await probe;
    assert.equal(breaker.state, 'CLOSED');
    assert.equal(breaker.snapshot().consecutiveFailures, 0);
  });

  it('탐침이 실패하면 다시 열리고 대기를 처음부터 센다', async () => {
    const { breaker, advance } = harness(2, 1000);
    await failTimes(breaker, 2);
    advance(1500);
    await assert.rejects(breaker.run(down));
    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.snapshot().retryAfterMs, 1000);

    advance(999);
    assert.equal(breaker.allowsRequest(), false);
    advance(1);
    assert.equal(breaker.allowsRequest(), true);
  });

  it('한 번 열려도 의존성이 살아나면 반드시 닫힌다', async () => {
    // 이게 없으면 중앙이 살아나도 통합 조회가 영원히 죽는다.
    const { breaker, advance, changes } = harness(1, 500);
    await failTimes(breaker, 1);
    advance(500);
    assert.equal(await breaker.run(ok), 'ok');
    assert.deepEqual(
      changes.map((c) => `${c.from}->${c.to}`),
      ['CLOSED->OPEN', 'OPEN->HALF_OPEN', 'HALF_OPEN->CLOSED'],
    );
  });

  it('isFailure 로 표시한 결과는 던지지 않아도 실패로 센다', async () => {
    const { breaker } = harness(2);
    const serverError = () => Promise.resolve({ status: 503 });
    const res = await breaker.run(serverError, { isFailure: httpServerError });
    assert.equal(res.status, 503, '결과는 그대로 돌려준다');
    await breaker.run(serverError, { isFailure: httpServerError });
    assert.equal(breaker.state, 'OPEN');
    assert.equal(breaker.snapshot().lastFailure, 'HTTP_503');
  });

  it('4xx 는 의존성의 실패가 아니다 — 우리 요청의 문제다', async () => {
    const { breaker } = harness(1);
    await breaker.run(() => Promise.resolve({ status: 409 }), { isFailure: httpServerError });
    await breaker.run(() => Promise.resolve({ status: 400 }), { isFailure: httpServerError });
    assert.equal(breaker.state, 'CLOSED');
  });

  it('타임아웃과 DependencyFailure 의 원인을 남긴다', async () => {
    const { breaker } = harness(5);
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    await assert.rejects(breaker.run(() => Promise.reject(timeout)));
    assert.equal(breaker.snapshot().lastFailure, 'TIMEOUT');
    await assert.rejects(breaker.run(() => Promise.reject(new DependencyFailure('pg', 'PG_DOWN'))));
    assert.equal(breaker.snapshot().lastFailure, 'PG_DOWN');
  });

  it('잘못된 설정은 만들 때 거부한다', () => {
    assert.throws(() => new CircuitBreaker({ name: 'x', failureThreshold: 0, openMs: 1 }));
    assert.throws(() => new CircuitBreaker({ name: 'x', failureThreshold: 1, openMs: 0 }));
  });
});
