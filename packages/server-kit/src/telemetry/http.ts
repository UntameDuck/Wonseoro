/**
 * HTTP 서버 지표·span (T-M4-20). 접수 API 에서 시작해 모든 Fastify 서비스가 같이 쓴다.
 * 지표 이름은 HPA 커스텀 지표(T-M4-08)가 기대므로 바꾸지 않는다. 서비스는 service.name 으로 구분한다.
 */
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
  description: 'HTTP 요청 수',
});
const requestDuration = meter.createHistogram('http_server_request_duration', {
  description: 'HTTP 요청 처리 시간',
  unit: 's',
});
const activeRequests = meter.createObservableGauge('http_server_active_requests', {
  description: '처리 중 HTTP 요청 수',
  unit: '{request}',
});
let activeRequestCount = 0;
activeRequests.addCallback((result) => result.observe(activeRequestCount));
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
  activeRequestCount += 1;
  context.with(trace.setSpan(parentContext, span), next);
}

export function finishHttpRequestSpan(request: object, input: HttpMetricInput): void {
  activeRequestCount = Math.max(0, activeRequestCount - 1);
  const span = requestSpans.get(request);
  if (!span) return;

  const attributes = safeHttpMetricAttributes(input);
  span.updateName(`${attributes['http.request.method']} ${attributes['http.route']}`);
  span.setAttributes(attributes);
  if (input.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
  requestSpans.delete(request);
}

/** Fastify 의 필요한 부분만. server-kit 이 fastify 에 의존하지 않게 한다. */
export interface HttpTelemetryHost {
  addHook(name: 'onRequest' | 'onResponse', hook: (...args: any[]) => void): unknown;
}

/** Fastify 인스턴스에 요청 지표·서버 span 훅을 건다. 본문·쿼리·헤더 값은 어디에도 남기지 않는다. */
export function installHttpTelemetry(fastify: HttpTelemetryHost): void {
  fastify.addHook(
    'onRequest',
    (request: { method: string; headers: RequestHeaders }, _reply: unknown, done: () => void) => {
      startHttpRequestSpan(request, request.method, request.headers, done);
    },
  );
  fastify.addHook(
    'onResponse',
    (
      request: { method: string; routeOptions?: { url?: string } },
      reply: { statusCode: number; elapsedTime: number },
      done: () => void,
    ) => {
      const metric = {
        method: request.method,
        route: request.routeOptions?.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      };
      recordHttpRequest(metric);
      finishHttpRequestSpan(request, metric);
      done();
    },
  );
}
