import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestSample, MAX_CLOCK_OFFSET_MS, ServerClock } from './server-clock';

/**
 * 서버 시각 — v1.1 §01 A2 · A9
 *
 * 노드 시계와 DB 시계를 대조한다. 판정이 틀리면 두 방향 모두 사고다 — 어긋난 노드가 접수를
 * 확정하거나, 멀쩡한 노드가 부하 중 왕복 지연 때문에 접수에서 빠진다.
 */
describe('서버 시각 측정 (§A9)', () => {
  it('왕복이 가장 짧은 표본을 쓰고, 왕복의 절반을 불확실성으로 둔다', () => {
    const sample = bestSample([
      // 왕복 400ms — 부하 중. 한가운데 가정이 크게 틀릴 수 있다
      { sentAtMs: 10_000, receivedAtMs: 10_400, dbTimeMs: 9_700 },
      // 왕복 20ms — 이것을 쓴다. 노드 시각 한가운데 10_010 − DB 9_500 = +510
      { sentAtMs: 10_000, receivedAtMs: 10_020, dbTimeMs: 9_500 },
    ]);
    assert.ok(sample);
    assert.equal(sample.offsetMs, 510);
    assert.equal(sample.uncertaintyMs, 10);
  });

  it('잘못된 표본(음수 왕복)은 버린다', () => {
    assert.equal(bestSample([{ sentAtMs: 10, receivedAtMs: 5, dbTimeMs: 7 }]), null);
  });

  it('now() 는 DB 시계에 맞춘 시각이다 — 노드가 앞서면 그만큼 뺀다', () => {
    const clock = new ServerClock();
    clock.record({ offsetMs: 2_000, uncertaintyMs: 5, dbTimeMs: Date.now() - 2_000 });
    const skew = Date.now() - clock.now().getTime();
    assert.ok(skew >= 1_990 && skew <= 2_010, `노드 시계보다 2초 뒤여야 한다 (차이 ${skew}ms)`);
  });

  it('재기 전에는 UNMEASURED — 노드 시계를 그대로 쓴다', () => {
    const clock = new ServerClock();
    assert.equal(clock.reading().status, 'UNMEASURED');
    assert.ok(Math.abs(clock.now().getTime() - Date.now()) < 50);
  });

  it('허용오차 안이면 SYNCED', () => {
    const clock = new ServerClock();
    clock.record({ offsetMs: MAX_CLOCK_OFFSET_MS - 1, uncertaintyMs: 3, dbTimeMs: Date.now() });
    assert.equal(clock.reading().status, 'SYNCED');
  });

  it('불확실성을 빼고도 허용오차를 넘으면 OFFSET_EXCEEDED — 이 노드는 접수를 확정하지 않는다', () => {
    const clock = new ServerClock();
    clock.record({ offsetMs: -(MAX_CLOCK_OFFSET_MS + 200), uncertaintyMs: 50, dbTimeMs: Date.now() });
    assert.equal(clock.reading().status, 'OFFSET_EXCEEDED');
  });

  it('왕복 지연 때문에 넘은 것처럼 보이면 노드를 빼지 않는다 — 부하 중 오판 방지', () => {
    const clock = new ServerClock();
    // 1,100ms 로 재었지만 ±300ms 라 실제로는 800ms 일 수 있다
    clock.record({ offsetMs: 1_100, uncertaintyMs: 300, dbTimeMs: Date.now() });
    assert.equal(clock.reading().status, 'SYNCED');
  });

  it('마지막 측정이 오래되면 STALE — 값은 남기되 지금도 맞는지 모른다고 드러낸다', () => {
    const clock = new ServerClock(MAX_CLOCK_OFFSET_MS, 30_000);
    const localNow = Date.now();
    clock.record({ offsetMs: 12, uncertaintyMs: 2, dbTimeMs: localNow }, localNow - 31_000);
    const r = clock.reading(localNow);
    assert.equal(r.status, 'STALE');
    assert.equal(r.offsetMs, 12);
  });
});
