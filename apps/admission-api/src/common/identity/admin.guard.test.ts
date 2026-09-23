import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { ADMIN_API_TOKEN } from '../../config';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, method: 'POST', url: '/admin/v1/x', ip: '127.0.0.1' }),
    }),
  } as unknown as ExecutionContext;
}

const status = (fn: () => unknown): number | undefined => {
  try {
    fn();
    return undefined;
  } catch (err) {
    return (err as { problem?: { status: number } }).problem?.status;
  }
};

describe('운영 API 문지기 (v1.1 §06·§09)', () => {
  const guard = new AdminGuard();

  it('토큰이 설정되지 않은 개발 환경에서는 통과시킨다', (t) => {
    if (ADMIN_API_TOKEN) return t.skip('ADMIN_API_TOKEN 이 설정된 환경');
    assert.equal(guard.canActivate(contextWith({})), true);
  });

  it('토큰이 설정되어 있으면 Bearer 가 없을 때 거부한다', (t) => {
    if (!ADMIN_API_TOKEN) return t.skip('ADMIN_API_TOKEN 미설정');
    assert.equal(status(() => guard.canActivate(contextWith({}))), 403);
  });

  it('토큰이 틀리면 거부한다', (t) => {
    if (!ADMIN_API_TOKEN) return t.skip('ADMIN_API_TOKEN 미설정');
    assert.equal(
      status(() => guard.canActivate(contextWith({ authorization: 'Bearer wrong' }))),
      403,
    );
  });

  it('토큰이 맞으면 통과한다', (t) => {
    if (!ADMIN_API_TOKEN) return t.skip('ADMIN_API_TOKEN 미설정');
    assert.equal(
      guard.canActivate(contextWith({ authorization: `Bearer ${ADMIN_API_TOKEN}` })),
      true,
    );
  });
});
