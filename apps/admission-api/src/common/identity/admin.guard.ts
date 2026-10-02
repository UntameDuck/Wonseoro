import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isProduction } from '@wonseoro/server-kit';
import { ADMIN_API_TOKEN, AUTH_MODE, OIDC } from '../../config';
import { ProblemException } from '../problem/problem.exception';
import { ADMIN_SCOPE_KEY, SCOPE_ROLES, STEP_UP_KEY, type AdminScopeName } from './admin-scope';

/**
 * 운영 API 문지기 — 기술설계서 v1.1 §06, §09 (Elevation of Privilege), STRIDE E-03
 *
 * `/admin/v1` 뒤에는 마감시각 변경, 설정 활성화, 지원자 PII 열람, 불일치 해소가 있다.
 *
 * AUTH_MODE=oidc (T-M5-02·10)
 *   신원은 앞단 훅(oidc-auth.ts)이 담당자 렐름 토큰으로 이미 확인했다. 여기서는 경로마다
 *   ① 계약 범위(@AdminScope)에 맞는 역할이 있는가 ② 비밀번호+OTP 로 로그인했는가(acr)
 *   ③ 민감 동작(@StepUp)이면 방금 직접 인증했는가(auth_time) 를 본다. 범위가 안 붙은 경로는 닫는다.
 *
 * 그 밖의 모드(개발·gateway)
 *   `ADMIN_API_TOKEN` 공유 비밀 — 누가 했는지 구분하지 못하는 임시 문이다. 운영에서 값이 없으면 기동하지 않는다.
 *   감사에는 `x-admin-id` 를 남긴다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (AUTH_MODE === 'oidc') return this.oidc(context, req);

    if (!ADMIN_API_TOKEN) {
      // 운영이면 여기 오기 전에 기동이 막힌다. 개발에서만 지나간다.
      if (isProduction()) throw ProblemException.forbidden('운영 API 가 구성되지 않았습니다.');
      return true;
    }

    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw ProblemException.forbidden('운영 API 접근 권한이 없습니다.');
    }

    if (!constantTimeEquals(header.slice('Bearer '.length), ADMIN_API_TOKEN)) {
      // 어떤 경로가 어디서 두드려졌는지는 남긴다. 토큰 값은 남기지 않는다.
      this.logger.warn(`admin token mismatch: ${req.method} ${req.url} from ${req.ip}`);
      throw ProblemException.forbidden('운영 API 접근 권한이 없습니다.');
    }

    return true;
  }

  private oidc(context: ExecutionContext, req: FastifyRequest): boolean {
    const identity = req.identity;
    // 훅이 담당자 토큰을 확인하지 못했으면 여기 오지 않는다. 와도 열지 않는다
    if (identity?.kind !== 'staff') throw ProblemException.unauthenticated();

    const targets = [context.getHandler(), context.getClass()];
    const scope = this.reflector.getAllAndOverride<AdminScopeName | undefined>(ADMIN_SCOPE_KEY, targets);
    if (!scope) {
      this.logger.error(`권한 범위가 없는 운영 경로를 닫음: ${req.method} ${req.routeOptions?.url}`);
      throw ProblemException.forbidden('이 작업을 할 권한이 없습니다.');
    }
    const allowed = SCOPE_ROLES[scope];
    if (!identity.roles.some((r) => allowed.includes(r))) {
      // 누가 어느 경로를 두드렸는지 남긴다 — 수직 권한 상승 시도 탐지(STRIDE E-03)
      this.logger.warn(`역할 부족: ${identity.adminId} [${identity.roles.join(',')}] → ${req.method} ${req.routeOptions?.url} (필요: ${scope})`);
      throw ProblemException.forbidden('이 작업을 할 권한이 없습니다.');
    }

    const policy = OIDC!;
    if (identity.acr !== policy.staffAcr) throw ProblemException.stepUpRequired(policy.staffAcr);

    if (this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP_KEY, targets)) {
      const age = identity.authTime === null ? Infinity : Date.now() / 1000 - identity.authTime;
      if (age > policy.stepUpMaxAgeSec) throw ProblemException.stepUpRequired(policy.staffAcr, policy.stepUpMaxAgeSec);
    }
    return true;
  }
}

/**
 * 길이가 다르면 비교 자체가 불가능하므로 먼저 걸러낸다.
 * 길이는 비밀이 아니고, 내용 비교는 시간이 일정해야 한다.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
