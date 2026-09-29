import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import * as grpc from '@grpc/grpc-js';

const API_URL = 'http://127.0.0.1:3100';
const METRICS_URL = 'http://127.0.0.1:9466/metrics';
const COLLECTOR_ADDRESS = '127.0.0.1:14317';
const PII_SENTINEL = 'telemetry-check-applicant@example.com';

const tracePayloads = [];
const traceService = {
  export: {
    path: '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
    requestStream: false,
    responseStream: false,
    requestSerialize: (value) => value,
    requestDeserialize: (value) => value,
    responseSerialize: (value) => value,
    responseDeserialize: (value) => value,
  },
};

const collector = new grpc.Server();
collector.addService(traceService, {
  export(call, callback) {
    tracePayloads.push(Buffer.from(call.request));
    callback(null, Buffer.alloc(0));
  },
});

await new Promise((resolve, reject) => {
  collector.bindAsync(COLLECTOR_ADDRESS, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) reject(error);
    else resolve();
  });
});

const child = spawn(process.execPath, ['apps/admission-api/dist/main.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: '3100',
    OTEL_ENABLED: 'true',
    OTEL_METRICS_PORT: '9466',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://${COLLECTOR_ADDRESS}`,
    OTEL_BSP_SCHEDULE_DELAY: '100',
    UNIVERSITY_ID: 'UNIV-A',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://kadmission_app:kadmission_app_dev@localhost:5432/univ_a',
    CENTRAL_GATE_AUTOSTART: 'false',
    PAYMENT_RECHECK_AUTOSTART: 'false',
    RECON_SCHEDULE_AUTOSTART: 'false',
    ALLOW_ENV_DEADLINE_POLICY: 'true',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'univ-a-documents',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'wonseoro',
    S3_SECRET_KEY: 'wonseoro123',
    S3_FORCE_PATH_STYLE: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
child.stdout.on('data', (chunk) => (logs += chunk.toString()));
child.stderr.on('data', (chunk) => (logs += chunk.toString()));

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // 기동 중
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`기동 대기 시간 초과: ${url}\n${logs.slice(-4_000)}`);
}

async function waitUntil(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('조건 대기 시간 초과');
}

try {
  await waitFor(METRICS_URL);
  const response = await fetch(`${API_URL}/api/v1/admission-cycles/current`, {
    headers: {
      'x-applicant-id': PII_SENTINEL,
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    },
  });
  assert.equal(response.status, 200);

  const metrics = await (await fetch(METRICS_URL)).text();
  assert.match(metrics, /http_requests_total\{[^\n]*http_route="\/api\/v1\/admission-cycles\/current"/);
  assert.match(metrics, /http_server_request_duration_count/);
  assert.match(metrics, /http_server_active_requests/);
  assert.equal(metrics.includes(PII_SENTINEL), false);

  const expectedSpanName = Buffer.from('GET /api/v1/admission-cycles/current');
  await waitUntil(() => Buffer.concat(tracePayloads).includes(expectedSpanName));

  child.kill('SIGTERM');
  const exit = await Promise.race([
    new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('admission-api 정상 종료 시간 초과')), 15_000),
    ),
  ]);
  assert.ok(exit.code === 0 || exit.signal === 'SIGTERM');

  const tracePayload = Buffer.concat(tracePayloads);
  assert.ok(tracePayload.length > 0, 'Collector가 trace payload를 받지 못했다');
  assert.ok(tracePayload.includes(expectedSpanName));
  assert.equal(tracePayload.includes(Buffer.from(PII_SENTINEL)), false);

  console.log('telemetry smoke: metrics 3종, OTLP/gRPC trace, PII sentinel 미노출 확인');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => collector.tryShutdown(resolve));
}
