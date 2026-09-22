import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryIdempotencyStore } from './idempotency.store';

describe('Idempotency Store (v1.1 §B12 / §01 E 인수기준)', () => {
  it('처음 보는 키는 선점되고 null 을 반환한다', async () => {
    const store = new InMemoryIdempotencyStore();
    const first = await store.acquire('k1', 'hash-a');
    assert.equal(first, null);
  });

  it('같은 키를 다시 잡으면 기존 레코드를 반환한다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire('k1', 'hash-a');
    const second = await store.acquire('k1', 'hash-a');
    assert.ok(second);
    assert.equal(second.status, 'IN_FLIGHT');
  });

  it('완료 후에는 저장된 응답을 돌려준다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire('k1', 'hash-a');
    await store.complete('k1', 200, { submissionId: 'sub-1' });

    const replay = await store.acquire('k1', 'hash-a');
    assert.ok(replay);
    assert.equal(replay.status, 'COMPLETED');
    assert.deepEqual(replay.responseBody, { submissionId: 'sub-1' });
  });

  it('같은 키에 다른 요청이 오면 지문이 다르게 남는다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire('k1', 'hash-a');
    const conflict = await store.acquire('k1', 'hash-b');
    assert.ok(conflict);
    // 인터셉터는 이 불일치를 409 idempotency-key-reused 로 변환한다.
    assert.notEqual(conflict.requestHash, 'hash-b');
  });

  it('실패한 요청은 키를 풀어 재시도를 허용한다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire('k1', 'hash-a');
    await store.release('k1');
    const retry = await store.acquire('k1', 'hash-a');
    assert.equal(retry, null, '풀린 뒤에는 새 요청처럼 처리되어야 한다');
  });

  it('동일 키 100회 요청에서 실행은 1회뿐이다 — Submission 1건 보장의 근거', async () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;

    const handle = async (): Promise<unknown> => {
      const existing = await store.acquire('finalize-key', 'hash-a');
      if (existing) {
        return existing.responseBody ?? { replayed: true };
      }
      executions += 1;
      const body = { submissionId: 'sub-1', applicationNumber: '2027-A-000001' };
      await store.complete('finalize-key', 200, body);
      return body;
    };

    const results = await Promise.all(Array.from({ length: 100 }, () => handle()));

    assert.equal(executions, 1, '핸들러는 정확히 한 번만 실행되어야 한다');
    assert.equal(results.length, 100);
  });
});
