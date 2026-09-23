import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isProduction } from '@wonseoro/server-kit';
import { ADMIN_API_TOKEN } from '../../config';
import { ProblemException } from '../problem/problem.exception';

/**
 * 운영 API 문지기 — 기술설계서 v1.1 §06, §09 (Elevation of Privilege)
 *
 * `/admin/v1` 뒤에는 마감시각 변경, 설정 활성화, 지원자 PII 열람, 불일치 해소가 있다.
 * 인증 게이트웨이(T-M5-10)가 붙기 전까지 이 경로가 열려 있으면,
 * 네트워크가 닿는 누구나 헤더 한 줄로 마감을 바꿀 수 있다.
 *
 * 그래서 최소한의 문을 만든다.
 *   - `ADMIN_API_TOKEN` 이 설정되어 있으면 Bearer 로 일치해야 한다
 *   - 운영에서는 이 값이 없으면 **아예 기동하지 않는다** (config.ts)
 *
 * 이것은 인증이 아니다. 공유 비밀 하나라 누가 했는지 구분하지 못한다.
 * 그래서 감사에는 `x-admin-id` 를 계속 남긴다 — 문과 기록은 다른 문제다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();

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
