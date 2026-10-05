// 경보 대응표 다시 쓰기 — docs/14 「경보 대응표」를 경보 규칙(expiry-rules.yaml)의 이름·심각도·지속·안내 문구로 다시 만든다 (D-93)
//   node scripts/render-alert-runbook.mjs
// 경보를 더하거나 문구를 고친 뒤 돌린다. npm run check:alert-rules 는 표에 모든 경보가 있는지 본다
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
const groups = parse(readFileSync('deploy/platform/observability/expiry-rules.yaml', 'utf8')).serverFiles['alerting_rules.yml'].groups;
const rows = [];
for (const g of groups) for (const r of g.rules) {
  const s = r.annotations.summary.replace(/\{\{ \$labels\.(\w+) \}\}/g, '{$1}').replace(/\|/g, '·');
  const sev = r.labels.severity + (r.labels.page === 'true' ? '·호출' : '');
  rows.push(`| \`${r.alert}\` | ${sev} | ${r.for} | ${s} |`);
}
const table = ['| 경보 | 심각도 | 지속 | 안내(먼저 볼 것) |', '|---|---|---|---|', ...rows].join('\n');
const f = 'docs/14-operations-automation.md';
let d = readFileSync(f, 'utf8');
const head = '## 경보 대응표';
const block = `${head}\n\n` +
  '규칙 원본은 [`deploy/platform/observability/expiry-rules.yaml`](../deploy/platform/observability/expiry-rules.yaml)(이름과 달리 모든 경보), 시험은 `tests/alert-rules.test.yaml` — `npm run check:alert-rules` 가 이 표에 모든 경보가 있는지도 본다(경보를 더하면 `node scripts/render-alert-runbook.mjs`). ' +
  '`{namespace}` 등은 경보 이름표. 심각도의 "호출" 은 `page: "true"`. 수치 기준은 설계서 상수·앱 설정을 그대로 쓰고 새로 만들지 않았다(D-93).\n\n' + table + '\n';
if (d.includes(head)) {
  const start = d.indexOf(head);
  const next = d.indexOf('\n## ', start + head.length);
  d = d.slice(0, start) + block + (next >= 0 ? d.slice(next) : '');
} else {
  d = d.trimEnd() + '\n\n' + block;
}
writeFileSync(f, d);
console.log(`경보 ${rows.length}개를 ${f} 「경보 대응표」에 썼다`);
