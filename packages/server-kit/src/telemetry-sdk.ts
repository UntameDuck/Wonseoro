/**
 * OpenTelemetry SDK 시작 (T-M4-20) — 모든 서버 프로세스 공용.
 *
 * **index 로 내보내지 않는다.** index 를 거치면 `pg` 가 SDK 보다 먼저 로드돼 DB span 이 빠진다.
 * 각 서비스의 `src/instrumentation.ts` 가 main 의 첫 import 로 이 파일만 부른다:
 *
 *   import { startTelemetry } from '@wonseoro/server-kit/dist/telemetry-sdk';
 *
 * - 지표: Prometheus pull (`OTEL_METRICS_PORT`, 기본 9464)
 * - Trace: `OTEL_EXPORTER_OTLP_ENDPOINT` 가 있을 때만 OTLP/gRPC. 없으면 전송하지 않는다
 * - 로그는 OTLP 로 보내지 않는다 — stdout 구조화 로그(StructuredLogger)를 수집기가 가져간다
 */
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AggregationType } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
} from '@opentelemetry/semantic-conventions';

export function startTelemetry(serviceName: string): () => Promise<void> {
  if (process.env.OTEL_ENABLED === 'false') return async () => undefined;

  const metricsPort = Number(process.env.OTEL_METRICS_PORT ?? 9464);
  const collectorEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  // SDK 기본값이 로컬 OTLP 전송을 시도하지 않도록, 구성한 신호만 명시적으로 켠다.
  process.env.OTEL_NODE_EXPERIMENTAL_SDK_METRICS ??= 'true';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  if (!collectorEndpoint) {
    process.env.OTEL_TRACES_EXPORTER ??= 'none';
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_NAMESPACE]: 'k-admission',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? 'development',
      'k_admission.university.id': process.env.UNIVERSITY_ID ?? 'unknown',
    }),
    metricReaders: [
      new PrometheusExporter({
        host: '0.0.0.0',
        port: Number.isInteger(metricsPort) && metricsPort > 0 ? metricsPort : 9464,
      }),
    ],
    views: [
      {
        meterName: 'k-admission.http',
        instrumentName: 'http_server_request_duration',
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: {
            // 초 단위. 목표 300~500ms 주변을 세밀하게 나눠 p95가 5초로 뭉개지지 않게 한다.
            boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5],
          },
        },
      },
    ],
    ...(collectorEndpoint
      ? { traceExporter: new OTLPTraceExporter({ url: collectorEndpoint }) }
      : {}),
    instrumentations: collectorEndpoint
      ? [
          new NestInstrumentation(),
          new PgInstrumentation({ enhancedDatabaseReporting: false }),
        ]
      : [],
  });

  sdk.start();
  return () => sdk.shutdown();
}
