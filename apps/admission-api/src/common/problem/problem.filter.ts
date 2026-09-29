import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CACHE_CONTROL_PII,
  HEADER_REQUEST_ID,
  HEADER_TRACEPARENT,
  MEDIA_PROBLEM,
  ProblemCode,
  ProblemDetails,
  problemType,
} from '@wonseoro/contracts';
import { ProblemException } from './problem.exception';

/**
 * 모든 오류를 application/problem+json 으로 변환한다.
 *
 * 주의: 오류 응답에 개인정보를 넣지 않는다. (v1.0 §15 / v1.1 §B8)
 * 스택 트레이스·요청 본문은 절대 응답에 포함하지 않는다.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      // 요청 본문·개인정보는 로깅하지 않는다. 원인 규명에 필요한
      // 오류 종류와 메시지만 남긴다. (v1.1 §B8)
      const cause =
        exception instanceof Error ? `${exception.name}: ${exception.message}` : 'unknown';
      this.logger.error(
        `${problem.status} ${problem.code} trace=${problem.traceId} ${request.method} ${request.url} cause=${cause}`,
      );
    }

    void reply
      .status(problem.status)
      .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
      .header('cache-control', CACHE_CONTROL_PII)
      .send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const traceId = requestTraceId(request);

    if (exception instanceof ProblemException) {
      return {
        ...exception.problem,
        instance: request.url,
        traceId: exception.problem.traceId || traceId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? ProblemCode.NOT_FOUND : ProblemCode.INTERNAL;
      return {
        type: problemType(code),
        title: exception.message,
        status,
        code,
        traceId,
        instance: request.url,
      };
    }

    // DB 연결을 기다리다 시간이 다 됐다 — 마감 피크의 일시적 포화다. 500 이 아니라 재시도 안내(503)로 답한다.
    // 변경 요청은 모두 Idempotency-Key 를 쓰고 핵심 변경은 한 트랜잭션이라, 같은 키로 다시 보내도 두 번 반영되지 않는다
    // (T-M4-40 kind 시험에서 확인)
    if (isTransientDbSaturation(exception)) {
      return {
        ...ProblemException.retryable('접속이 몰려 잠시 처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.').problem,
        instance: request.url,
        traceId,
      };
    }

    return {
      type: problemType(ProblemCode.INTERNAL),
      title: '서버 내부 오류가 발생했습니다',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ProblemCode.INTERNAL,
      traceId,
      instance: request.url,
    };
  }
}

/**
 * 연결 풀 포화 — pg-pool 이 connectionTimeoutMillis 안에 연결을 못 준 경우, PgBouncer 가 클라이언트 상한으로
 * 거절한 경우. 그 쿼리는 연결을 얻지 못해 실행되지 않았다.
 */
export function isTransientDbSaturation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /timeout exceeded when trying to connect|no more connections allowed|too many clients already/i.test(error.message);
}

/** traceparent: 00-<trace-id>-<span-id>-<flags>. Nest 밖(Fastify 훅)에서 만든 problem 도 같은 값을 쓴다. */
export function requestTraceId(request: FastifyRequest): string {
  const tp = request.headers[HEADER_TRACEPARENT];
  if (typeof tp === 'string') {
    const parts = tp.split('-');
    if (parts[1]) return parts[1];
  }
  const rid = request.headers[HEADER_REQUEST_ID];
  if (typeof rid === 'string' && rid) return rid;
  return request.id ?? '';
}
