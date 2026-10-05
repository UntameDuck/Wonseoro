// 앱·공용 패키지가 import 하는 패키지가 각 package.json 에 선언돼 있는지 확인한다.
//
// 모노레포 개발 환경에서는 루트 node_modules 에 다 있어서 선언을 빠뜨려도 돈다.
// 운영 이미지는 서비스별 운영 의존성만 설치하므로 거기서 처음 깨진다 —
// document-service 가 @wonseoro/server-kit 을 선언하지 않아 kind 배포에서 기동하지 못했다. (T-M4-01)
// 시험·빌드 전용 import도 devDependencies까지 포함해 직접 선언돼 있어야 한다.
//
//   npm run check:deps
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const builtin = new Set(builtinModules);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(?:[cm]?js|tsx?)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function packageSourceFiles(root) {
  const sourceDir = join(root, 'src');
  const sourceFiles = existsSync(sourceDir) ? files(sourceDir) : [];
  const configFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => join(root, entry.name));
  return [...sourceFiles, ...configFiles];
}

/** 'a/b/c' → 'a', '@s/a/b' → '@s/a' */
const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

function packageImports(source, { runtimeOnly }) {
  const specs = new Set();
  const patterns = runtimeOnly
    ? [
        /(?:import|export)\s+(?!type\s)[^'\"]*?from\s+['\"]([^'\"]+)['\"]/g,
        /import\s+['\"]([^'\"]+)['\"]/g,
        /(?:require|import)\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
      ]
    : [
        /(?:import|export)\s+(?:type\s+)?[^'\"]*?from\s+['\"]([^'\"]+)['\"]/g,
        /import\s+['\"]([^'\"]+)['\"]/g,
        /(?:require|import)\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
      ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('#')) continue;
      const dependency = pkgOf(spec);
      if (!builtin.has(dependency)) specs.add(dependency);
    }
  }
  return specs;
}

function isTestSource(path) {
  return /\.(?:test|spec)\.tsx?$/.test(path) || path.includes(`${sep}test-support${sep}`);
}

export function checkPackage(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const productionDeclared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const developmentDeclared = new Set([...productionDeclared, ...Object.keys(pkg.devDependencies ?? {})]);
  const runtimeUsed = new Set();
  const buildAndTestUsed = new Set();

  const sourceDir = join(root, 'src') + sep;
  for (const file of packageSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    if (file.startsWith(sourceDir) && !isTestSource(file)) {
      for (const dependency of packageImports(source, { runtimeOnly: true })) runtimeUsed.add(dependency);
    }
    for (const dependency of packageImports(source, { runtimeOnly: false })) buildAndTestUsed.add(dependency);
  }

  const missingRuntime = [...runtimeUsed]
    .filter((dependency) => !productionDeclared.has(dependency) && dependency !== pkg.name)
    .sort();
  const missingBuildAndTest = [...buildAndTestUsed]
    .filter(
      (dependency) =>
        !developmentDeclared.has(dependency) && dependency !== pkg.name && !missingRuntime.includes(dependency),
    )
    .sort();

  return { name: pkg.name, missingRuntime, missingBuildAndTest };
}

export function workspaceRoots(root) {
  const workspacePatterns = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces ?? [];
  return workspacePatterns.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return existsSync(join(root, pattern, 'package.json')) ? [join(root, pattern)] : [];
    const parent = join(root, pattern.slice(0, -2));
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, 'package.json')))
      .map((entry) => join(parent, entry.name));
  });
}

function main() {
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const requested = process.argv.slice(2);
  const roots = requested.length ? requested.map((root) => resolve(root)) : workspaceRoots(scriptRoot);

  let failed = false;
  for (const root of roots) {
    const result = checkPackage(root);
    if (result.missingRuntime.length) {
      failed = true;
      console.log(`✖ ${result.name}: 선언하지 않은 운영 의존성 ${result.missingRuntime.join(', ')}`);
    }
    if (result.missingBuildAndTest.length) {
      failed = true;
      console.log(`✖ ${result.name}: 선언하지 않은 빌드·시험 의존성 ${result.missingBuildAndTest.join(', ')}`);
    }
    if (!result.missingRuntime.length && !result.missingBuildAndTest.length) console.log(`✔ ${result.name}`);
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
