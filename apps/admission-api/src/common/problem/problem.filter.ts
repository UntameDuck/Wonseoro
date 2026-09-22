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
    const traceId = this.traceId(request);

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

    return {
      type: problemType(ProblemCode.INTERNAL),
      title: '서버 내부 오류가 발생했습니다',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ProblemCode.INTERNAL,
      traceId,
      instance: request.url,
    };
  }

  /** traceparent: 00-<trace-id>-<span-id>-<flags> */
  private traceId(request: FastifyRequest): string {
    const tp = request.headers[HEADER_TRACEPARENT];
    if (typeof tp === 'string') {
      const parts = tp.split('-');
      if (parts[1]) return parts[1];
    }
    const rid = request.headers[HEADER_REQUEST_ID];
    if (typeof rid === 'string' && rid) return rid;
    return request.id ?? '';
  }
}
