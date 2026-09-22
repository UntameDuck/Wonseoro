/** 모든 mutation 은 Idempotency-Key 를 요구한다. 예외 없음. (v1.1 §B12) */
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
/** Draft PATCH 의 낙관적 동시성 제어. */
export const HEADER_IF_MATCH = 'if-match';
export const HEADER_ETAG = 'etag';
export const HEADER_TRACEPARENT = 'traceparent';
export const HEADER_REQUEST_ID = 'x-request-id';

/** OpenAPI #/components/parameters/IdempotencyKey 의 제약. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** Draft PATCH 요청 본문 미디어 타입. OpenAPI 계약상 merge-patch 다. */
export const MEDIA_MERGE_PATCH = 'application/merge-patch+json';
export const MEDIA_PROBLEM = 'application/problem+json';
export const MEDIA_CLOUDEVENTS = 'application/cloudevents+json';

/** 개인정보 응답 기본값. */
export const CACHE_CONTROL_PII = 'no-store';
