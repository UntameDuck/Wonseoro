// 서비스가 import 하는 패키지가 그 서비스의 package.json 에 선언돼 있는지 확인한다.
//
// 모노레포 개발 환경에서는 루트 node_modules 에 다 있어서 선언을 빠뜨려도 돈다.
// 운영 이미지는 서비스별 운영 의존성만 설치하므로 거기서 처음 깨진다 —
// document-service 가 @wonseoro/server-kit 을 선언하지 않아 kind 배포에서 기동하지 못했다. (T-M4-01)
//
//   node scripts/check-deps.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const APPS = ['admission-api', 'event-relay', 'document-service', 'central-api'];
const PKGS = ['contracts', 'server-kit'];
const builtin = new Set(builtinModules);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !p.includes('test-support')) out.push(p);
  }
  return out;
}

/** 'a/b/c' → 'a', '@s/a/b' → '@s/a' */
const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

let failed = false;
for (const [kind, name] of [...APPS.map((a) => ['apps', a]), ...PKGS.map((p) => ['packages', p])]) {
  const root = join(kind, name);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const used = new Set();
  for (const f of files(join(root, 'src'))) {
    const src = readFileSync(f, 'utf8');
    // `import type` 은 컴파일에서 지워진다 — 런타임 의존성이 아니다.
    for (const m of src.matchAll(/(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'".][^'"]*)['"]|require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('node:')) continue;
      const p = pkgOf(spec);
      if (!builtin.has(p)) used.add(p);
    }
  }
  const missing = [...used].filter((p) => !declared.has(p) && p !== pkg.name);
  if (missing.length) {
    failed = true;
    console.log(`✖ ${pkg.name}: 선언하지 않은 의존성 ${missing.join(', ')}`);
  } else {
    console.log(`✔ ${pkg.name}`);
  }
}
process.exit(failed ? 1 : 0);
