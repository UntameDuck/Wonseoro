// T-M4-20 로컬 축소 검증 — kind univ-a 의 세 워크로드가 지표를 내고 Prometheus 가 모으는가, 로그가 구조화돼 있는가
//
// 전제: kind-univ-a 에 새 이미지가 배포되어 있고 observability 네임스페이스에 Prometheus(T-M4-08)가 떠 있다.
// 수집기(OTLP)는 로컬에 없으므로 Trace 전송은 tests/m4/telemetry-smoke.mjs·Relay 통합 시험이 맡는다.
//
//   node tests/m4/telemetry-kind.mjs
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CONTEXT = 'kind-univ-a';
const NAMESPACE = 'kadmission-app';
const WORKLOADS = [
  ['univ-a-api', 'admission-api'],
  ['univ-a-event-relay', 'event-relay'],
  ['univ-a-document-service', 'document-service'],
];
const PROM = '/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query';
const PII = [/\b\d{6}-?[1-8]\d{6}\b/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, /\b01[016-9]-?\d{3,4}-?\d{4}\b/];

const result = {
  test: 'T-M4-20',
  scenario: '세 워크로드 지표 수집·구조화 로그 (kind)',
  environment: 'local-kind-univ-a (축소 환경)',
  limitations: [
    '로컬에는 OpenTelemetry Collector 가 없어 클러스터 안 Trace 전송은 확인하지 않았다 — telemetry-smoke(OTLP/gRPC 모의 수집기)와 Relay→중앙 traceparent 통합 시험이 맡는다.',
    '로그 수집기(Loki 등)는 없다. kubectl logs 로 stdout 형식만 확인했다.',
  ],
  startedAt: new Date().toISOString(),
  checks: {},
};

function check(name, pass, detail = {}) {
  result.checks[name] = { pass, ...detail };
  console.log(`${pass ? '✔' : '✖'} ${name} ${JSON.stringify(detail)}`);
}
const kubectl = (args) =>
  exec('kubectl', ['--context', CONTEXT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout);

async function prom(query) {
  const raw = await kubectl(['get', '--raw', `${PROM}?query=${encodeURIComponent(query)}`]);
  return JSON.parse(raw).data.result;
}

for (const [deployment, service] of WORKLOADS) {
  const d = JSON.parse(await kubectl(['-n', NAMESPACE, 'get', 'deployment', deployment, '-o', 'json']));
  const ready = `${d.status.readyReplicas ?? 0}/${d.spec.replicas}`;
  const container = d.spec.template.spec.containers[0];
  const metricsPort = container.ports.find((p) => p.name === 'metrics')?.containerPort;
  const scrape = d.spec.template.metadata.annotations?.['prometheus.io/scrape'];
  check(`${service} 배포·지표 포트`, (d.status.readyReplicas ?? 0) === d.spec.replicas && metricsPort === 9464 && scrape === 'true',
    { ready, metricsPort, scrape });

  // 지금 떠 있는 Pod 만 본다 — 롤아웃으로 사라진 Pod 의 시계열은 staleness 전까지 up=0 으로 남는다
  const pods = JSON.parse(await kubectl(['-n', NAMESPACE, 'get', 'pods', '-o', 'json'])).items
    .map((pod) => pod.metadata.name).filter((name) => name.startsWith(`${deployment}-`));
  const up = (await prom(`up{namespace="${NAMESPACE}",pod=~"${deployment}-.*"}`))
    .filter((series) => pods.includes(series.metric.pod));
  check(`${service} Prometheus 수집(up=1)`,
    up.length === pods.length && up.every((series) => series.value[1] === '1'),
    { pods: pods.length, targets: up.map((series) => `${series.metric.pod}=${series.value[1]}`) });

  const requests = await prom(`sum by (http_route) (http_requests_total{namespace="${NAMESPACE}",pod=~"${deployment}-.*"})`);
  check(`${service} HTTP 지표`, requests.length > 0,
    { routes: requests.map((s) => `${s.metric.http_route}=${Math.round(Number(s.value[1]))}`) });

  const info = await prom(`target_info{namespace="${NAMESPACE}",pod=~"${deployment}-.*"}`);
  check(`${service} service.name 리소스 속성`, info.length > 0 && info.every((s) => s.metric.service_name === service),
    { serviceNames: [...new Set(info.map((s) => s.metric.service_name))] });

  const logs = (await kubectl(['-n', NAMESPACE, 'logs', `deployment/${deployment}`, '--tail=200']))
    .split(/\r?\n/).filter((l) => l.trim() !== '');
  const plain = logs.filter((l) => !l.startsWith('{'));
  const records = logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  check(`${service} 로그 전부 구조화 JSON`,
    logs.length > 0 && plain.length === 0 && records.every((r) => r.service === service && r.time && r.level),
    { lines: logs.length, plain: plain.slice(0, 3) });
  check(`${service} 로그에 개인정보 형태 없음`, !logs.some((l) => PII.some((p) => p.test(l))), { lines: logs.length });
}

result.finishedAt = new Date().toISOString();
result.pass = Object.values(result.checks).every((c) => c.pass);
mkdirSync('tests/m4/results', { recursive: true });
const output = `tests/m4/results/telemetry-kind-${result.startedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`결과: ${output} (${result.pass ? 'PASS' : 'FAIL'})`);
process.exit(result.pass ? 0 : 1);
