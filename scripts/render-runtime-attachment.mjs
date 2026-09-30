// 노션 §05 첨부 `k-admission-runtime.yaml` 을 차트에서 만든다 (D-44).
//
// 첫 첨부는 손으로 쓴 매니페스트라 차트·구현과 갈라졌다(포트·프로브·NODE_ENV·대조 CronJob·마감 버전).
// v1.2 부터 runtime 첨부는 **차트 + values-m 을 렌더링한 결과**다. 손으로 고치지 않는다 — 차트나 values-m 을
// 고치고 이 스크립트로 다시 만든 뒤, 노션 첨부도 같은 파일로 교체한다(R5).
//
//   node scripts/render-runtime-attachment.mjs          # deploy/platform/policies/runtime.yaml 을 다시 쓴다
//   node scripts/render-runtime-attachment.mjs --check  # 차트와 첨부 사본이 어긋나면 실패 (CI)
//
// production 렌더링은 서명된 digest·실 검사 엔진이 없으면 실패한다(§A6, T-M5-08). 예시 첨부이므로 통과용
// 자리표시값으로 렌더링한 뒤, 출력에서 다시 `REPLACE_WITH_…` 로 바꾼다 — 그대로 배포하면 기동하지 않는다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'deploy/platform/policies/runtime.yaml';
const DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const ENGINE = 'placeholder-scanner-engine';

const rendered = execFileSync('helm', [
  'template', 'univ-a', 'deploy/charts/k-admission',
  '--namespace', 'kadmission-app',
  '-f', 'deploy/charts/k-admission/values.yaml',
  '-f', 'deploy/charts/k-admission/values-m.yaml',
  '--set', `api.image.digest=${DIGEST}`,
  '--set', `eventRelay.image.digest=${DIGEST}`,
  '--set', `documentService.image.digest=${DIGEST}`,
  '--set', `database.pooler.image.digest=${DIGEST}`,
  '--set', `documentService.scannerEngine=${ENGINE}`,
  '--set', 'runtimeSecret.name=kadmission-univ-a-runtime',
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const header = [
  '# K-Admission runtime manifests - M profile, UNIV-A example (v1.2, 2026-09-30)',
  '#',
  '# GENERATED - do not edit. Rendered from the Helm chart deploy/charts/k-admission with',
  '# values.yaml + values-m.yaml by scripts/render-runtime-attachment.mjs (spec discrepancy register D-44).',
  '# The first attachment was hand-written and drifted from the implementation (Spring profile, port 8080,',
  '# /internal/health probes, reconcile CronJob, deploy-time deadline/config versions). Change the chart or',
  '# values-m.yaml, regenerate, and replace this attachment with the same bytes.',
  '#',
  '# REPLACE_WITH_SIGNED_DIGEST / REPLACE_WITH_SCANNER_ENGINE are placeholders: production refuses to start',
  '# without signed image digests (A6) and a real document scanning engine (T-M5-08).',
  '# Secrets are never rendered here - Vault injects the Secret named by runtimeSecret.name (06).',
  '',
].join('\n');

const body = rendered
  .replaceAll(DIGEST, 'sha256:REPLACE_WITH_SIGNED_DIGEST')
  .replaceAll(ENGINE, 'REPLACE_WITH_SCANNER_ENGINE')
  // helm 버전·렌더 시각처럼 실행마다 달라지는 값은 없다. 줄 끝 공백만 정리한다.
  .replace(/[ \t]+$/gm, '');
const content = `${header}${body.endsWith('\n') ? body : `${body}\n`}`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== content) {
    console.error(`✖ ${OUT} 가 차트 렌더링 결과와 다르다 — node scripts/render-runtime-attachment.mjs 로 다시 만들고 노션 §05 첨부도 교체한다`);
    process.exit(1);
  }
  console.log(`✔ ${OUT} = 차트 렌더링 결과 (${Buffer.byteLength(content)}바이트)`);
} else {
  writeFileSync(OUT, content);
  console.log(`${OUT} ${Buffer.byteLength(content)}바이트`);
}
