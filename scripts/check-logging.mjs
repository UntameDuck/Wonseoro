// 로그 마스킹 강제 (T-M4-24, §01 B8) — 서버 코드가 구조화·마스킹 로거를 우회하지 못하게 한다.
//
//   1. 서버 코드(테스트 제외)는 console.* · process.stdout/stderr.write 를 쓰지 않는다
//      — 쓰면 마스킹·trace_id 없이 원문이 나간다. 예외는 로거 자신뿐이다
//   2. 각 서비스 main.ts 의 첫 import 는 ./instrumentation 이다 — SDK 와 전역 로거가 먼저 선다
//   3. 각 서비스 instrumentation.ts 는 전역 Nest 로거를 StructuredLogger 로 바꾼다
//
//   node scripts/check-logging.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = ['admission-api', 'event-relay', 'document-service', 'central-api'];
const ROOTS = [...SERVICES.map((s) => join('apps', s, 'src')), join('packages', 'server-kit', 'src')];
const ALLOWED = new Set([join('packages', 'server-kit', 'src', 'telemetry', 'logger.ts')]);
const RAW_OUTPUT = /\bconsole\.(log|info|warn|error|debug|trace)\s*\(|process\.(stdout|stderr)\.write\s*\(/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !p.includes('test-support')) out.push(p);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of files(root)) {
    if (ALLOWED.has(file)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (RAW_OUTPUT.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        problems.push(`${file}:${i + 1} 원문 출력 — Nest Logger(구조화·마스킹)를 쓴다`);
      }
    });
  }
}

for (const service of SERVICES) {
  const main = readFileSync(join('apps', service, 'src', 'main.ts'), 'utf8');
  const firstImport = main.split(/\r?\n/).find((line) => line.startsWith('import '));
  if (!firstImport?.includes("from './instrumentation'")) {
    problems.push(`apps/${service}/src/main.ts 첫 import 가 ./instrumentation 이 아니다`);
  }
  if (!main.includes('new StructuredLogger(')) {
    problems.push(`apps/${service}/src/main.ts 가 앱 로거로 StructuredLogger 를 넘기지 않는다`);
  }
  const instrumentation = readFileSync(join('apps', service, 'src', 'instrumentation.ts'), 'utf8');
  if (!/Logger\.overrideLogger\(new StructuredLogger\(/.test(instrumentation)) {
    problems.push(`apps/${service}/src/instrumentation.ts 가 전역 로거를 바꾸지 않는다`);
  }
}

if (problems.length) {
  for (const p of problems) console.log(`✖ ${p}`);
  process.exit(1);
}
console.log(`✔ 로그 출력 경로: 서비스 ${SERVICES.length}곳 구조화·마스킹 로거 강제`);
