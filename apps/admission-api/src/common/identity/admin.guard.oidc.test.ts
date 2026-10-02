import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';

/**
 * 운영 API 문지기 — AUTH_MODE=oidc (T-M5-02·10, STRIDE E-03 수직 권한)
 *
 * 설정은 모듈을 읽을 때 정해진다. 이 파일은 따로 도는 프로세스라(node --test) 여기서 oidc 로 바꾸고 읽는다.
 * 역할 6종 × 범위 3종, 인증 수준(acr), 재인증 시각(auth_time)을 본다. 신원은 앞단 훅이 붙인 것을 흉내 낸다.
 */
process.env.AUTH_MODE = 'oidc';
process.env.UNIVERSITY_ID ??= 'UNIV-GUARD';
process.env.OIDC_APPLICANT_ISSUER = 'http://localhost:18080/realms/wonseoro-applicant';
process.env.OIDC_STAFF_ISSUER = 'http://localhost:18080/realms/wonseoro-staff';

type Guard = { canActivate(ctx: ExecutionContext): boolean };
let guard: Guard;
let scope: typeof import('./admin-scope');

const ROLES = ['platform-viewer', 'sre-operator', 'admission-admin', 'security-auditor', 'release-controller', 'break-glass'];

/** 테스트용 핸들러·클래스 — 데코레이터 메타데이터만 쓴다 */
function handlers() {
  class Target {
    adminRead() {}
    operatorRun() {}
    auditorRead() {}
    approve() {}
    unscoped() {}
  }
  const p = Target.prototype as unknown as Record<string, object>;
  const put = (key: string, value: unknown, fn: object) => Reflect.defineMetadata(key, value, fn);
  put(scope.ADMIN_SCOPE_KEY, 'admin', p.adminRead!);
  put(scope.ADMIN_SCOPE_KEY, 'operator', p.operatorRun!);
  put(scope.ADMIN_SCOPE_KEY, 'auditor', p.auditorRead!);
  put(scope.ADMIN_SCOPE_KEY, 'admin', p.approve!);
  put(scope.STEP_UP_KEY, true, p.approve!);
  return { Target, p };
}

function ctx(handler: object, cls: object, identity: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, method: 'POST', url: '/admin/v1/x', routeOptions: { url: '/admin/v1/x' }, ip: '127.0.0.1', identity }),
    }),
  } as unknown as ExecutionContext;
}

const staff = (roles: string[], o: { acr?: string | null; authAgoSec?: number } = {}) => ({
  kind: 'staff',
  adminId: 'admin-a',
  subject: 'sub-1',
  roles,
  acr: o.acr === undefined ? 'mfa' : o.acr,
  authTime: Math.floor(Date.now() / 1000) - (o.authAgoSec ?? 10),
});

/** 통과면 'ok', 아니면 상태코드·code */
function outcome(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (err) {
    const p = (err as { problem?: { status: number; code: string }; headers?: Record<string, string> }).problem;
    return p ? `${p.status} ${p.code}` : `throw ${(err as Error).message}`;
  }
}

before(async () => {
  scope = await import('./admin-scope');
  const { AdminGuard } = await import('./admin.guard');
  guard = new AdminGuard();
});

describe('운영 API 문지기 — oidc (T-M5-02·10)', () => {
  it('신원이 없거나 지원자 신원이면 401', () => {
    const { Target, p } = handlers();
    assert.equal(outcome(() => guard.canActivate(ctx(p.adminRead!, Target, undefined))), '401 UNAUTHENTICATED');
    assert.equal(outcome(() => guard.canActivate(ctx(p.adminRead!, Target, { kind: 'applicant', applicantId: 'a', subjectToken: 's' }))), '401 UNAUTHENTICATED');
  });

  it('권한 범위가 안 붙은 운영 경로는 닫는다(닫힌 실패)', () => {
    const { Target, p } = handlers();
    assert.equal(outcome(() => guard.canActivate(ctx(p.unscoped!, Target, staff(['admission-admin'])))), '403 FORBIDDEN');
  });

  it('역할 6종 × 범위 3종 — 범위에 맞는 역할만 연다', () => {
    const { Target, p } = handlers();
    const table: Record<string, Record<string, string>> = {};
    for (const role of ROLES) {
      table[role] = {
        admin: outcome(() => guard.canActivate(ctx(p.adminRead!, Target, staff([role])))),
        operator: outcome(() => guard.canActivate(ctx(p.operatorRun!, Target, staff([role])))),
        auditor: outcome(() => guard.canActivate(ctx(p.auditorRead!, Target, staff([role])))),
      };
    }
    const F = '403 FORBIDDEN';
    assert.deepEqual(table, {
      'platform-viewer': { admin: F, operator: F, auditor: F },
      'sre-operator': { admin: F, operator: F, auditor: F },
      'admission-admin': { admin: 'ok', operator: 'ok', auditor: F },
      'security-auditor': { admin: F, operator: F, auditor: 'ok' },
      'release-controller': { admin: F, operator: F, auditor: F },
      'break-glass': { admin: F, operator: F, auditor: F },
    });
  });

  it('비밀번호만으로 로그인한 토큰(acr 이 mfa 가 아님)은 재인증을 요구한다', () => {
    const { Target, p } = handlers();
    for (const acr of ['pwd', '1', null]) {
      assert.equal(outcome(() => guard.canActivate(ctx(p.adminRead!, Target, staff(['admission-admin'], { acr })))), '401 STEP_UP_REQUIRED');
    }
  });

  it('민감 동작은 5분 안에 직접 인증했어야 한다 — 넘으면 max_age 를 알려 준다', () => {
    const { Target, p } = handlers();
    assert.equal(outcome(() => guard.canActivate(ctx(p.approve!, Target, staff(['admission-admin'], { authAgoSec: 60 })))), 'ok');
    let header = '';
    try {
      guard.canActivate(ctx(p.approve!, Target, staff(['admission-admin'], { authAgoSec: 301 })));
    } catch (err) {
      header = (err as { headers: Record<string, string> }).headers['www-authenticate'] ?? '';
      assert.equal((err as { problem: { code: string } }).problem.code, 'STEP_UP_REQUIRED');
    }
    assert.match(header, /error="insufficient_user_authentication"/);
    assert.match(header, /acr_values="mfa"/);
    assert.match(header, /max_age=300/);
    // 일반 조회는 오래된 인증이어도 연다(세션 수명은 발급자가 정한다)
    assert.equal(outcome(() => guard.canActivate(ctx(p.adminRead!, Target, staff(['admission-admin'], { authAgoSec: 3600 })))), 'ok');
  });

  it('인증 시각이 없는 토큰은 민감 동작을 열지 않는다', () => {
    const { Target, p } = handlers();
    const id = { ...staff(['admission-admin']), authTime: null };
    assert.equal(outcome(() => guard.canActivate(ctx(p.approve!, Target, id))), '401 STEP_UP_REQUIRED');
  });
});
