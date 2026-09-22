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
  HEADER_TRACEPARENT,
  ProblemDetails,
  PROBLEM_BASE,
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
      // 본문은 로깅하지 않는다. 식별은 traceId 로만 한다.
      this.logger.error(
        `${problem.status} ${problem.type} trace=${problem.traceId ?? '-'}`,
      );
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .header('cache-control', CACHE_CONTROL_PII)
      .send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const traceId = this.traceId(request);

    if (exception instanceof ProblemException) {
      return { ...exception.problem, instance: request.url, traceId };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        type: `${PROBLEM_BASE}/http-${status}`,
        title: exception.message,
        status,
        instance: request.url,
        traceId,
      };
    }

    return {
      type: 'about:blank',
      title: '서버 내부 오류가 발생했습니다',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance: request.url,
      traceId,
    };
  }

  private traceId(request: FastifyRequest): string | undefined {
    const header = request.headers[HEADER_TRACEPARENT];
    if (typeof header !== 'string') return undefined;
    // traceparent: 00-<trace-id>-<span-id>-<flags>
    return header.split('-')[1];
  }
}
