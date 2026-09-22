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
import { IdempotencyStore } from './idempotency.store';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 모든 mutation 에 Idempotency-Key 를 강제한다. 예외 없음. (v1.1 §B12)
 *
 * 동작
 *   키 없음                 → 400 idempotency-key-required
 *   최초 요청               → 처리 후 응답을 레코드에 저장
 *   같은 키 + 같은 요청      → 저장된 응답을 그대로 재생 (상태를 다시 바꾸지 않는다)
 *   같은 키 + 다른 요청      → 409 idempotency-key-reused
 *   같은 키 + 처리 중        → 409 (재시도 유도). 중복 실행보다 거절이 낫다
 *
 * 이 인터셉터가 있으면 Finalize 100회 재전송 시 Submission 이 1건만 생긴다.
 * (v1.1 §01 E 핵심 인수기준)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (!MUTATION_METHODS.has(request.method)) {
      return next.handle();
    }

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

    const requestHash = hashRequest(request);

    return from(this.store.acquire(key, requestHash)).pipe(
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
          // 저장된 응답 재생 — 핸들러를 다시 실행하지 않는다.
          return of(existing.responseBody);
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              const status = context.switchToHttp().getResponse<{ statusCode?: number }>()
                .statusCode ?? 200;
              void this.store.complete(key, status, body);
            },
            error: () => {
              // 실패한 요청은 키를 풀어 사용자가 재시도할 수 있게 한다.
              void this.store.release(key);
            },
          }),
        );
      }),
    );
  }
}

/**
 * 요청 지문. method + path + body 를 정규화해 해시한다.
 * 키 값 자체는 해시에 넣지 않는다 (같은 키로 다른 요청이 온 경우를 잡아야 하므로).
 */
function hashRequest(request: FastifyRequest): string {
  const payload = JSON.stringify({
    method: request.method,
    url: request.url,
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
