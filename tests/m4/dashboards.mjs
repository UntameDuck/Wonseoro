// 대시보드·KPI 규칙 일관성 (T-M4-21·22·23)
//
//   node tests/m4/dashboards.mjs                       # 정적 검사 (CI)
//   node tests/m4/dashboards.mjs --live kind-univ-a    # 모든 패널 쿼리를 그 클러스터의 Prometheus 에 던져 본다
//
// 정적 검사
//   - 패널이 쓰는 kadmission:* 규칙은 kpi-rules.yaml 에 있어야 한다 (정의는 한 곳)
//   - 설계서 §15 업무 KPI 7종·§10.4 Support 고정 5종·Golden Signals 4분류가 빠짐없이 패널에 있다
//   - 패널 쿼리·규칙 식에 PII 성격의 라벨(원서·지원자·거래 식별자)을 쓰지 않는다
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const DIR = 'deploy/platform/observability';
const rules = parse(readFileSync(`${DIR}/kpi-rules.yaml`, 'utf8')).serverFiles['recording_rules.yml'].groups
  .flatMap((g) => g.rules);
const defined = new Set(rules.map((r) => r.record));
const dashboards = Object.fromEntries(['golden-signals', 'business-kpi', 'support'].map((name) => [
  name, JSON.parse(readFileSync(`${DIR}/dashboards/${name}.json`, 'utf8')),
]));

const exprs = (d) => d.panels.flatMap((p) => p.targets.map((t) => ({ panel: p.title, expr: t.expr })));
const FORBIDDEN_LABELS = /\b(application_id|applicant_id|subject_token|provider_tx_id|payment_id|document_id|email|phone)\b/;

// 1) 규칙 참조
for (const [name, d] of Object.entries(dashboards)) {
  assert.equal(new Set(d.panels.map((p) => p.id)).size, d.panels.length, `${name}: 패널 id 중복`);
  for (const { panel, expr } of exprs(d)) {
    for (const ref of expr.match(/kadmission:[a-z0-9_:]+/g) ?? []) {
      assert.ok(defined.has(ref), `${name}/${panel}: 규칙 ${ref} 가 kpi-rules.yaml 에 없다`);
    }
    assert.doesNotMatch(expr, FORBIDDEN_LABELS, `${name}/${panel}: 식별자 라벨을 쓴다`);
  }
}
for (const r of rules) assert.doesNotMatch(r.expr, FORBIDDEN_LABELS, `${r.record}: 식별자 라벨을 쓴다`);
assert.equal(new Set(Object.values(dashboards).map((d) => d.uid)).size, 3, '대시보드 uid 중복');

// 2) 설계서 지표가 빠짐없이
const titles = (d) => d.panels.map((p) => p.title).join('\n');
for (const kpi of ['draft_save_success_rate', 'payment_verify_success_rate', 'finalize_success_rate',
  'finalize_retry_rate', 'outbox_oldest_age_seconds', 'central_sync_lag_seconds', 'document_scan_pending']) {
  assert.match(titles(dashboards['business-kpi']), new RegExp(`^${kpi}$`, 'm'), `업무 KPI ${kpi} 패널 없음 (§15)`);
}
for (const fixed of ['finalize success rate', 'payment verify latency p95', 'outbox backlog', 'DB lock wait', 'error rate']) {
  assert.match(titles(dashboards.support), new RegExp(`^${fixed}$`, 'm'), `Support 고정 지표 ${fixed} 없음 (§10.4)`);
}
for (const signal of ['Traffic', 'Errors', 'Latency', 'Saturation']) {
  assert.match(titles(dashboards['golden-signals']), new RegExp(`^${signal} — `, 'm'), `Golden Signal ${signal} 없음 (§15)`);
}
console.log(`✔ 대시보드 3종·규칙 ${rules.length}개 일관성`);

// 3) 선택: 실제 Prometheus 에 던져 보기
const liveIndex = process.argv.indexOf('--live');
if (liveIndex !== -1) {
  const context = process.argv[liveIndex + 1];
  const exec = promisify(execFile);
  let withData = 0;
  const all = Object.entries(dashboards).flatMap(([name, d]) => exprs(d).map((e) => ({ name, ...e })));
  for (const { name, panel, expr } of all) {
    const path = `/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query?query=${encodeURIComponent(expr)}`;
    const { stdout } = await exec('kubectl', ['--context', context, 'get', '--raw', path], { maxBuffer: 8 << 20 });
    const body = JSON.parse(stdout);
    assert.equal(body.status, 'success', `${name}/${panel}: ${body.error ?? ''}`);
    if (body.data.result.length > 0) withData += 1;
  }
  console.log(`✔ ${context}: 패널 쿼리 ${all.length}개 모두 평가 성공 (지금 값이 있는 것 ${withData}개)`);
}
