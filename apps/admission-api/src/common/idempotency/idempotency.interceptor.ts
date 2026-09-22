import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  HEADER_IDEMPOTENCY_KEY,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '@wonseoro/contracts';
import { ProblemException } from '../problem/problem.exception';
import { IdempotencyScope, IdempotencyStore } from './idempotency.store';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음. (v1.1 §B12)
 *
 * 동작
 *   키 없음 / 길이 위반      → 400
 *   최초 요청                → 처리 후 응답을 레코드에 저장
 *   같은 키 + 같은 요청       → 저장된 응답을 그대로 재생 (상태를 다시 바꾸지 않는다)
 *   같은 키 + 다른 요청       → 409 idempotency-key-reused
 *   같은 키 + 처리 중         → 503 재시도 유도. 중복 실행보다 거절이 낫다
 *
 * ⚠️ applicationId 가 경로에 없는 요청(POST /applications)은 레코드를 남기지 않는다.
 * DDL 의 idempotency_record.application_id 가 NOT NULL 이기 때문이다. (D-12)
 * 생성 중복은 application 의 자연키 UNIQUE 제약이 막는다.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (!MUTATION_METHODS.has(request.method)) {
      return next.handle();
    }

    const key = this.requireKey(request);
    const applicationId = this.applicationId(request);

    // 경로에 원서가 없으면 저장소를 쓰지 않는다. 헤더 검증은 그대로 수행했다.
    if (!applicationId) {
      return next.handle();
    }

    const scope: IdempotencyScope = {
      applicationId,
      operation: this.operation(request),
      key,
    };
    const requestHash = hashRequest(request);

    return from(this.store.acquire(scope, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw ProblemException.idempotencyKeyReused();
          }
          if (existing.state === 'PROCESSING') {
            throw ProblemException.retryable(
              '같은 요청이 처리 중입니다. 잠시 후 다시 확인해 주십시오.',
            );
          }
          if (existing.state === 'COMPLETED') {
            // 저장된 응답 재생 — 핸들러를 다시 실행하지 않는다.
            return of(existing.responseBody);
          }
          // FAILED: 같은 키로 재시도를 허용하지 않는다. 새 키를 쓰게 한다.
          throw ProblemException.idempotencyKeyReused();
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              const status =
                context.switchToHttp().getResponse<{ statusCode?: number }>().statusCode ?? 200;
              void this.store.complete(scope, status, body);
            },
            error: () => {
              void this.store.fail(scope);
            },
          }),
        );
      }),
    );
  }

  private requireKey(request: FastifyRequest): string {
    const key = request.headers[HEADER_IDEMPOTENCY_KEY];
    if (typeof key !== 'string' || key.trim() === '') {
      throw ProblemException.idempotencyKeyRequired();
    }
    // OpenAPI #/components/parameters/IdempotencyKey: minLength 16, maxLength 200
    if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw ProblemException.idempotencyKeyInvalid(
        `Idempotency-Key 길이는 ${IDEMPOTENCY_KEY_MIN_LENGTH}~${IDEMPOTENCY_KEY_MAX_LENGTH}자여야 합니다.`,
      );
    }
    return key;
  }

  private applicationId(request: FastifyRequest): string | undefined {
    const params = request.params as Record<string, string> | undefined;
    return params?.applicationId;
  }

  /** 같은 키를 다른 작업에 재사용해도 서로 간섭하지 않게 한다. */
  private operation(request: FastifyRequest): string {
    const url = request.url.split('?')[0] ?? '';
    const tail = url.split('/').pop() ?? 'root';
    return `${request.method}:${tail}`.slice(0, 64);
  }
}

/**
 * 요청 지문. method + path + body 를 정규화해 해시한다.
 * 키 값 자체는 해시에 넣지 않는다 (같은 키로 다른 요청이 온 경우를 잡아야 하므로).
 */
function hashRequest(request: FastifyRequest): string {
  const payload = JSON.stringify({
    method: request.method,
    url: request.url.split('?')[0],
    body: canonical(request.body),
  });
  return createHash('sha256').update(payload).digest('hex');
}

/** 키 순서가 달라도 같은 요청으로 취급하도록 정렬한다. */
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonical((value as Record<string, unknown>)[k]);
      return acc;
    }, {});
}
