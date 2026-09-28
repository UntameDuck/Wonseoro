import {
  context,
  metrics,
  propagation,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type TextMapGetter,
} from '@opentelemetry/api';

const meter = metrics.getMeter('k-admission.http');
const requestCounter = meter.createCounter('http_requests', {
  description: '접수 API HTTP 요청 수',
});
const requestDuration = meter.createHistogram('http_server_request_duration', {
  description: '접수 API HTTP 요청 처리 시간',
  unit: 's',
});
const tracer = trace.getTracer('k-admission.http');
const requestSpans = new WeakMap<object, Span>();

type RequestHeaders = Record<string, string | string[] | undefined>;

const headerGetter: TextMapGetter<RequestHeaders> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key.toLowerCase()],
};

const SAFE_METHOD = /^[A-Z]{3,10}$/;
const SAFE_ROUTE = /^\/[A-Za-z0-9_./:{}-]{0,200}$/;
const UUID_OR_OPAQUE_SEGMENT = /(?:^|\/)(?:[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z0-9_-]{32,})(?:\/|$)/i;

export interface HttpMetricInput {
  method: string;
  route?: string;
  statusCode: number;
  durationMs: number;
}

export function safeHttpMetricAttributes(input: HttpMetricInput): Record<string, string | number> {
  const method = SAFE_METHOD.test(input.method) ? input.method : 'UNKNOWN';
  const route =
    input.route &&
    !input.route.includes('?') &&
    SAFE_ROUTE.test(input.route) &&
    !UUID_OR_OPAQUE_SEGMENT.test(input.route)
      ? input.route
      : 'unmatched';
  const statusCode =
    Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599
      ? input.statusCode
      : 0;

  return {
    'http.request.method': method,
    'http.route': route,
    'http.response.status_code': statusCode,
  };
}

export function recordHttpRequest(input: HttpMetricInput): void {
  const attributes = safeHttpMetricAttributes(input);
  requestCounter.add(1, attributes);
  requestDuration.record(Math.max(0, input.durationMs) / 1_000, attributes);
}

/**
 * 원시 URL을 자동 계측에 넘기지 않는 서버 span이다.
 * traceparent만 이어 받고, span 이름·속성은 응답 시점의 라우트 템플릿 allowlist로 확정한다.
 */
export function startHttpRequestSpan(
  request: object,
  method: string,
  headers: RequestHeaders,
  next: () => void,
): void {
  const parentContext = propagation.extract(context.active(), headers, headerGetter);
  const span = tracer.startSpan('HTTP request', { kind: SpanKind.SERVER }, parentContext);
  requestSpans.set(request, span);
  context.with(trace.setSpan(parentContext, span), next);
}

export function finishHttpRequestSpan(request: object, input: HttpMetricInput): void {
  const span = requestSpans.get(request);
  if (!span) return;

  const attributes = safeHttpMetricAttributes(input);
  span.updateName(`${attributes['http.request.method']} ${attributes['http.route']}`);
  span.setAttributes(attributes);
  if (input.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
  requestSpans.delete(request);
}
