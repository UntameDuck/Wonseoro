/** 모든 mutation 은 Idempotency-Key 를 요구한다. 예외 없음. (v1.1 §B12) */
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
/** Draft PATCH 의 낙관적 동시성 제어. */
export const HEADER_IF_MATCH = 'if-match';
export const HEADER_ETAG = 'etag';
export const HEADER_TRACEPARENT = 'traceparent';
export const HEADER_REQUEST_ID = 'x-request-id';

/** 개인정보 응답 기본값. */
export const CACHE_CONTROL_PII = 'no-store';
