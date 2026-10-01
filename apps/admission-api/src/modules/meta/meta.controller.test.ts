import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@wonseoro/server-kit';
import type { DeadlineService } from '../deadline/deadline.service';
import { MetaController } from './meta.controller';

describe('서버 시각 모집 선택', () => {
  it('모집 ID를 생략하면 현재 열린 모집의 정책을 사용한다', async () => {
    const seen: string[] = [];
    const db = {
      query: async () => ({ rows: [{ id: '11111111-1111-1111-1111-111111111111' }] }),
    } as unknown as Db;
    const deadline = {
      snapshot: async (cycleId: string) => {
        seen.push(cycleId);
        return { cycleId };
      },
    } as unknown as DeadlineService;

    const result = await new MetaController(deadline, db).time();
    assert.deepEqual(seen, ['11111111-1111-1111-1111-111111111111']);
    assert.deepEqual(result, { cycleId: '11111111-1111-1111-1111-111111111111' });
  });

  it('명시한 모집 ID는 그대로 사용하고 현재 모집을 다시 조회하지 않는다', async () => {
    const db = { query: async () => assert.fail('DB 조회를 하면 안 된다') } as unknown as Db;
    const deadline = { snapshot: async (cycleId: string) => cycleId } as unknown as DeadlineService;
    const cycleId = '22222222-2222-2222-2222-222222222222';
    assert.equal(await new MetaController(deadline, db).time(cycleId), cycleId);
  });

  it('열린 모집이 없으면 404로 답한다', async () => {
    const db = { query: async () => ({ rows: [] }) } as unknown as Db;
    const deadline = { snapshot: async () => assert.fail('정책을 조회하면 안 된다') } as unknown as DeadlineService;
    await assert.rejects(new MetaController(deadline, db).time(), (error: unknown) => {
      return (error as { problem?: { status?: number } }).problem?.status === 404;
    });
  });
});
