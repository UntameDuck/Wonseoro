// 경보 대응표 다시 쓰기 — docs/14 「경보 대응표」를 경보 규칙(expiry-rules.yaml)의 이름·심각도·지속·안내 문구로 다시 만든다 (D-93)
//   node scripts/render-alert-runbook.mjs           # 다시 쓴다
//   node scripts/render-alert-runbook.mjs --check   # 표가 규칙과 같은지만(CI)
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
const START = '<!-- alert-table:start — node scripts/render-alert-runbook.mjs 가 다시 쓴다 -->';
const END = '<!-- alert-table:end -->';
let d = readFileSync(f, 'utf8');
const a = d.indexOf(START);
const b = d.indexOf(END);
if (a < 0 || b < a) throw new Error(`${f} 에 표시 주석(${START} … ${END})이 없다`);
const next = d.slice(0, a) + START + '\n' + table + '\n' + d.slice(b);
// --check: 쓰지 않고 지금 표가 규칙과 같은지만 본다(CI — check:alert-rules 가 부른다)
if (process.argv.includes('--check')) {
  if (next !== d) {
    console.error(`✘ ${f} 「경보 대응표」가 경보 규칙과 다르다 — node scripts/render-alert-runbook.mjs`);
    process.exit(1);
  }
  console.log(`✔ 경보 대응표 — 경보 ${rows.length}개가 규칙과 같다`);
} else {
  writeFileSync(f, next);
  console.log(`경보 ${rows.length}개를 ${f} 「경보 대응표」에 썼다`);
}
