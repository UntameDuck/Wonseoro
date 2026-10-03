import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
/**
 * 모든 오류를 application/problem+json 으로 변환한다.
 *
 * 주의: 오류 응답에 개인정보를 넣지 않는다. (v1.0 §15 / v1.1 §B8)
 * 스택 트레이스·요청 본문은 절대 응답에 포함하지 않는다.
 */
export declare class ProblemFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): void;
    private toProblem;
}
/**
 * 연결 풀 포화 — pg-pool 이 connectionTimeoutMillis 안에 연결을 못 준 경우, PgBouncer 가 클라이언트 상한으로
 * 거절한 경우. 그 쿼리는 연결을 얻지 못해 실행되지 않았다.
 */
export declare function isTransientDbSaturation(error: unknown): boolean;
/** traceparent: 00-<trace-id>-<span-id>-<flags>. Nest 밖(Fastify 훅)에서 만든 problem 도 같은 값을 쓴다. */
export declare function requestTraceId(request: FastifyRequest): string;
