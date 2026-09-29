import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
} from '@opentelemetry/api';

/**
 * 서비스 사이 trace 이어 붙이기 (T-M4-20).
 *
 * 내부 호출(Relay → 중앙, 서류 워커 → 접수 API, 접수 API → 중앙 Vault)에만 쓴다.
 * 외부 PG·Object Storage 로는 보내지 않는다 — 우리 trace 식별자를 밖에 줄 이유가 없다.
 */
export function traceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

const SAFE_ATTRIBUTE_VALUE = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * 백그라운드 작업(Outbox 전송·서류 검사)을 span 으로 감싼다.
 * 속성은 식별자 형태의 짧은 값만 받는다 — 본문·자유 텍스트가 섞여 들어오면 버린다.
 */
export async function withSpan<T>(
  tracerName: string,
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'string' && SAFE_ATTRIBUTE_VALUE.test(value)) safe[key] = value;
  }
  const span = trace.getTracer(tracerName).startSpan(name, { kind, attributes: safe });
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

/** 지금 실행 중인 span 의 식별자. 로그 상관관계에 쓴다. */
export function activeTraceIds(): { trace_id: string; span_id: string } | null {
  const span = trace.getSpan(context.active());
  const ctx = span?.spanContext();
  if (!ctx || !trace.isSpanContextValid(ctx)) return null;
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}
