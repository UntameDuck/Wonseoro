import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { IdempotencyStore } from './idempotency.store';
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
export declare class IdempotencyInterceptor implements NestInterceptor {
    private readonly store;
    private readonly reflector;
    private readonly logger;
    constructor(store: IdempotencyStore, reflector?: Reflector);
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
    private guarded;
    /**
     * 응답 기록은 기다리지 않는다 — 요청은 이미 커밋됐고, 기록이 늦거나 실패해도 그 결과를 바꾸지 않는다.
     * 다만 실패를 잡지 않으면 처리되지 않은 Promise 거부로 **프로세스가 죽는다.** 마감 피크에 DB 풀이 잠깐
     * 모자라자 이 한 줄 때문에 API Pod 두 개가 연달아 재시작했다(T-M4-40 kind 시험). 기록을 못 한 요청을
     * 같은 키로 재시도하면 PROCESSING 으로 보여 재시도 안내(503)를 받는다 — 중복 실행보다 낫다.
     */
    private record;
    private requireKey;
    /**
     * 요청이 어느 원서의 것인가. 경로에 원서가 있으면 그것, 결제·서류 경로면 그 결제·서류의 원서.
     * 결제 확인·서류 완료·삭제도 같은 키로 재시도하면 같은 응답을 받아야 한다 — 전에는 원서 ID 가
     * 경로에 없다는 이유로 기록하지 않아, 재시도가 두 번 실행되거나 다른 오류로 돌아왔다.
     */
    private applicationId;
    /** 같은 키를 다른 작업에 재사용해도 서로 간섭하지 않게 한다. */
    private operation;
}
