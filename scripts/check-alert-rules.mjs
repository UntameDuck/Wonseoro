// Prometheus 경보·기록 규칙 검사 (T-M4-21~23·T-M5-65·D-75·D-91)
//
//   node scripts/check-alert-rules.mjs
//
// 규칙 파일(kpi-rules.yaml·expiry-rules.yaml)은 Prometheus chart values 라 promtool 이 바로 못 읽는다.
// serverFiles 아래 규칙 파일을 꺼내 .cache/promtool 에 쓰고
//   1) promtool check rules — 문법·식·중복
//   2) promtool test rules  — deploy/platform/observability/tests/*.test.yaml (경보가 울려야 할 때 울리고, 아닐 때 조용한지)
// 를 돌린다. promtool 이 PATH 에 없으면 로컬 축소 환경과 같은 Prometheus 이미지(v3.15.0, digest 고정)를 docker 로 쓴다.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

const DIR = 'deploy/platform/observability';
const VALUES = ['kpi-rules.yaml', 'expiry-rules.yaml'];
const IMAGE = 'prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e';
const OUT = resolve('.cache/promtool');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 같은 serverFiles 이름을 두 values 가 쓰면 helm 이 뒤 파일로 덮어 앞 규칙이 사라진다 — 그 사고를 막는다
const ruleFiles = [];
for (const values of VALUES) {
  const serverFiles = parse(readFileSync(join(DIR, values), 'utf8')).serverFiles ?? {};
  for (const [name, content] of Object.entries(serverFiles)) {
    if (ruleFiles.includes(name)) throw new Error(`${values}: serverFiles.${name} 이 다른 values 와 겹친다 — helm 이 앞 규칙을 덮어쓴다`);
    ruleFiles.push(name);
    writeFileSync(join(OUT, name), stringify(content));
  }
}
const tests = readdirSync(join(DIR, 'tests')).filter((f) => f.endsWith('.test.yaml'));
for (const t of tests) copyFileSync(join(DIR, 'tests', t), join(OUT, t));

const local = spawnSync('promtool', ['--version'], { stdio: 'ignore' }).status === 0;
function promtool(args) {
  const [cmd, argv] = local
    ? ['promtool', args]
    : ['docker', ['run', '--rm', '-v', `${OUT}:/work`, '-w', '/work', '--entrypoint', 'promtool', IMAGE, ...args]];
  execFileSync(cmd, argv, { cwd: OUT, stdio: 'inherit' });
}

promtool(['check', 'rules', ...ruleFiles]);
promtool(['test', 'rules', ...tests]);
console.log(`규칙 파일 ${ruleFiles.length}개 검사·단위 시험 ${tests.length}개 파일 통과 (${local ? 'promtool' : 'docker'})`);
