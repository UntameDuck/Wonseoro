// 경보·기록 규칙과 운영 대시보드를 실제 Prometheus 로 평가해 본다 (D-93)
//
//   node scripts/check-alert-rules.mjs                       # 먼저 — 규칙 파일을 .cache/promtool 에 꺼낸다
//   node scripts/check-alert-rules-live.mjs [--target=host.docker.internal:9474[,host.docker.internal:9475]] [--wait=40]
//
// 지표를 내는 대학 API 가 떠 있어야 한다(예: node --env-file=scripts/screenshots/env/admission.env apps/admission-api/dist/main.js — 지표 :9474).
// Prometheus(v3.15.0, digest 고정) 컨테이너가 그 /metrics 를 5초마다 수집하고 규칙을 평가한다. 끝나면 컨테이너를 지운다.
// 확인: 수집 대상 up · 모든 규칙 health=ok(식 오류·이름표 충돌 없음) · 운영 신호 대시보드 쿼리 모두 success.
// promtool 단위 시험은 가짜 시계열이고, 이것은 실제 앱이 내는 이름·이름표로 본다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const targets = arg('target', 'host.docker.internal:9474').split(',').filter(Boolean);
const waitSec = Number(arg('wait', '40'));
const IMAGE = 'prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e';
const NAME = `prom-live-${process.pid}`;
const PORT = 19090;
const SRC = resolve('.cache/promtool');
const DIR = resolve('.cache/promtool-live');

for (const f of ['alerting_rules.yml', 'recording_rules.yml']) {
  if (!existsSync(`${SRC}/${f}`)) throw new Error(`${SRC}/${f} 없음 — 먼저 node scripts/check-alert-rules.mjs`);
}
mkdirSync(DIR, { recursive: true });
for (const f of ['alerting_rules.yml', 'recording_rules.yml']) copyFileSync(`${SRC}/${f}`, `${DIR}/${f}`);
writeFileSync(`${DIR}/prometheus.yml`, `global: { scrape_interval: 5s, evaluation_interval: 5s }
rule_files: [/work/alerting_rules.yml, /work/recording_rules.yml]
scrape_configs:
  - job_name: kadmission
    # 쿠버네티스 수집처럼 대상마다 pod 이름표를 붙인다 — 없으면 (namespace, pod) 로 잇는 기록 규칙이 대상끼리 겹친다
    static_configs:
${targets.map((t, i) => `      - { targets: ['${t}'], labels: { namespace: live-check, pod: live-${i} } }`).join('\n')}
`);

const api = async (path) => (await fetch(`http://localhost:${PORT}/api/v1/${path}`)).json();
const problems = [];
execFileSync('docker', ['run', '-d', '--name', NAME, '-p', `${PORT}:9090`, '-v', `${DIR}:/work`, IMAGE, '--config.file=/work/prometheus.yml'], { stdio: 'ignore' });
try {
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  const active0 = (await api('targets')).data.activeTargets;
  for (const t of active0) if (t.health !== 'up') problems.push(`수집 대상 ${t.scrapeUrl} ${t.health} ${t.lastError}`);
  const rules = (await api('rules')).data.groups.flatMap((g) => g.rules);
  for (const r of rules) if (r.health !== 'ok') problems.push(`규칙 ${r.name}: ${r.lastError}`);
  const active = rules.filter((r) => r.type === 'alerting' && r.state !== 'inactive').map((r) => `${r.name}(${r.state})`);
  const dash = JSON.parse(readFileSync('deploy/platform/observability/dashboards/operations-signals.json', 'utf8'));
  let queries = 0;
  for (const p of dash.panels) for (const t of p.targets) {
    const r = await api(`query?query=${encodeURIComponent(t.expr)}`);
    queries += 1;
    if (r.status !== 'success') problems.push(`대시보드 ${p.title}: ${r.error}`);
  }
  console.log(`수집 대상 ${active0.length}개, 규칙 ${rules.length}개 평가, 대시보드 쿼리 ${queries}개`);
  console.log(`지금 대기·발생 중인 경보: ${active.join(', ') || '없음'} (축소 환경에서는 상호 TLS 가 없어 CredentialExpiryUnknown, 중앙 API 를 안 띄우면 DependencyCircuitOpen, Relay 를 안 띄우면 중앙의 UniversityHeartbeatStale, 기동 직후에는 ScheduledJobStale 대기가 정상)`);
} finally {
  execFileSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' });
}
if (problems.length) {
  for (const p of problems) console.error(`✘ ${p}`);
  process.exit(1);
}
console.log('✔ 실제 Prometheus 평가 — 문제 0');
