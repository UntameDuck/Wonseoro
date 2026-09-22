import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IdempotencyScope, InMemoryIdempotencyStore } from './idempotency.store';

const scope = (key: string, operation = 'POST:finalize'): IdempotencyScope => ({
  applicationId: '55555555-5555-5555-5555-555555555555',
  operation,
  key,
});

describe('Idempotency Store (v1.1 §B12 / §01 E 인수기준)', () => {
  it('처음 보는 키는 선점되고 null 을 반환한다', async () => {
    const store = new InMemoryIdempotencyStore();
    assert.equal(await store.acquire(scope('k1'), 'hash-a'), null);
  });

  it('같은 키를 다시 잡으면 PROCESSING 레코드를 반환한다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire(scope('k1'), 'hash-a');
    const second = await store.acquire(scope('k1'), 'hash-a');
    assert.ok(second);
    assert.equal(second.state, 'PROCESSING');
  });

  it('완료 후에는 저장된 응답을 돌려준다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire(scope('k1'), 'hash-a');
    await store.complete(scope('k1'), 201, { submissionId: 'sub-1' });

    const replay = await store.acquire(scope('k1'), 'hash-a');
    assert.ok(replay);
    assert.equal(replay.state, 'COMPLETED');
    assert.equal(replay.responseStatus, 201);
    assert.deepEqual(replay.responseBody, { submissionId: 'sub-1' });
  });

  it('같은 키에 다른 요청이 오면 지문 불일치로 드러난다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire(scope('k1'), 'hash-a');
    const conflict = await store.acquire(scope('k1'), 'hash-b');
    assert.ok(conflict);
    // 인터셉터는 이 불일치를 409 idempotency-key-reused 로 변환한다.
    assert.equal(conflict.requestHash, 'hash-a');
    assert.notEqual(conflict.requestHash, 'hash-b');
  });

  it('실패는 삭제가 아니라 FAILED 로 남는다 (D-11)', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire(scope('k1'), 'hash-a');
    await store.fail(scope('k1'));
    const after = await store.acquire(scope('k1'), 'hash-a');
    assert.ok(after);
    assert.equal(after.state, 'FAILED');
  });

  it('같은 키라도 작업이 다르면 간섭하지 않는다', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.acquire(scope('same-key', 'POST:finalize'), 'h');
    const other = await store.acquire(scope('same-key', 'PATCH:applications'), 'h');
    assert.equal(other, null, '다른 operation 은 별도 레코드여야 한다');
  });

  it('동일 키 100회 요청에서 실행은 1회뿐이다 — Submission 1건 보장의 근거', async () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;

    const handle = async (): Promise<unknown> => {
      const existing = await store.acquire(scope('finalize-key'), 'hash-a');
      if (existing) return existing.responseBody ?? { replayed: true };
      executions += 1;
      const body = { submissionId: 'sub-1', applicationNumber: '2027-A-000001' };
      await store.complete(scope('finalize-key'), 201, body);
      return body;
    };

    const results = await Promise.all(Array.from({ length: 100 }, () => handle()));

    assert.equal(executions, 1, '핸들러는 정확히 한 번만 실행되어야 한다');
    assert.equal(results.length, 100);
  });
});
