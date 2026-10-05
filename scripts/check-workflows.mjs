// GitHub Actions YAML 구조와 npm script 참조를 원격 실행 전에 검사한다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');

export function npmScriptsIn(command) {
  return [...command.matchAll(/\bnpm\s+run\s+([^\s\\]+)/g)].map((match) => match[1]);
}

export function npmRunsIn(command) {
  return [...command.matchAll(/\bnpm\s+run\s+([^\s\\]+)([^;&\n]*)/g)].map((match) => ({
    script: match[1],
    workspaces: [...match[2].matchAll(/(?:^|\s)(?:-w|--workspace(?:=|\s+))\s*([^\s]+)/g)].map((workspace) => workspace[1]),
  }));
}

export function localNodeTargetsIn(command) {
  return [...command.matchAll(/\bnode(?:\s+--[^\s]+)*\s+(?!-)(['"]?)([^\s'"]+)\1/g)].map((match) => match[2]);
}

export function localShellTargetsIn(command) {
  return [...command.matchAll(/\b(?:bash|sh)\s+(?!-)(['"]?)([^\s'"]+)\1/g)].map((match) => match[2]);
}

export function validatePackageScriptTargets(entries) {
  let checked = 0;
  let skippedGenerated = 0;
  for (const entry of entries) {
    for (const [name, command] of Object.entries(entry.scripts)) {
      for (const target of [...localNodeTargetsIn(command), ...localShellTargetsIn(command)]) {
        const normalized = target.replaceAll('\\', '/').replace(/^\.\//u, '');
        if (/^(?:dist|build|out|\.next)\//u.test(normalized)) {
          skippedGenerated += 1;
          continue;
        }
        if (/[*?{}[\]]/u.test(normalized)) {
          const prefix = normalized.split(/[*?{[\]]/u, 1)[0];
          const directory = prefix.endsWith('/') ? prefix.slice(0, -1) : dirname(prefix);
          if (!directory || !existsSync(resolve(entry.base, directory))) {
            throw new Error(`${entry.label}의 '${name}'이 없는 glob 기준 폴더 '${directory || target}'를 사용합니다`);
          }
          checked += 1;
          continue;
        }
        if (!existsSync(resolve(entry.base, target))) {
          throw new Error(`${entry.label}의 '${name}'이 없는 로컬 실행 파일 '${target}'을 호출합니다`);
        }
        checked += 1;
      }
    }
  }
  return { checked, skippedGenerated };
}

function commandBase(repositoryRoot, job, step, label, jobName, index) {
  const workingDirectory = step['working-directory'] ?? job.defaults?.run?.['working-directory'];
  if (!workingDirectory || String(workingDirectory).includes('${{')) return repositoryRoot;
  const base = resolve(repositoryRoot, String(workingDirectory));
  if (!existsSync(base)) throw new Error(`${label}: ${jobName} ${index + 1}번째 working-directory '${workingDirectory}'가 없습니다`);
  return base;
}

function validateUsesReference(value, context, repositoryRoot) {
  const uses = String(value);
  if (uses.startsWith('./')) {
    if (!existsSync(resolve(repositoryRoot, uses))) throw new Error(`${context} 로컬 참조 '${uses}'가 없습니다`);
  } else if (!uses.includes('@')) {
    throw new Error(`${context} uses에 버전이 없습니다`);
  }
}

export function validateWorkflow(source, catalog, label = 'workflow.yml', repositoryRoot = root) {
  const document = parseDocument(source, { uniqueKeys: true, prettyErrors: true });
  if (document.errors.length > 0) throw new Error(`${label}: ${document.errors.map((error) => error.message).join('; ')}`);
  const workflow = document.toJS();
  if (!workflow || typeof workflow !== 'object') throw new Error(`${label}: YAML 최상위가 객체가 아닙니다`);
  if (!workflow.on) throw new Error(`${label}: 실행 조건(on)이 없습니다`);
  if (!workflow.jobs || typeof workflow.jobs !== 'object' || Object.keys(workflow.jobs).length === 0) {
    throw new Error(`${label}: jobs가 없습니다`);
  }

  let steps = 0;
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!job || typeof job !== 'object') throw new Error(`${label}: ${jobName} 잡이 객체가 아닙니다`);
    if (job.uses) {
      validateUsesReference(job.uses, `${label}: ${jobName} 재사용 잡`, repositoryRoot);
      continue;
    }
    if (!job['runs-on']) throw new Error(`${label}: ${jobName} 잡에 runs-on이 없습니다`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) throw new Error(`${label}: ${jobName} 잡에 steps가 없습니다`);
    for (const [index, step] of job.steps.entries()) {
      steps += 1;
      if (step.uses) {
        validateUsesReference(step.uses, `${label}: ${jobName} ${index + 1}번째`, repositoryRoot);
      }
      if (typeof step.run === 'string') {
        const base = commandBase(repositoryRoot, job, step, label, jobName, index);
        for (const run of npmRunsIn(step.run)) {
          if (run.workspaces.length === 0 && !Object.hasOwn(catalog.root, run.script)) {
            throw new Error(`${label}: ${jobName}에서 루트에 없는 npm script '${run.script}'를 호출합니다`);
          }
          for (const workspace of run.workspaces) {
            const scripts = catalog.workspaces.get(workspace);
            if (!scripts) throw new Error(`${label}: ${jobName}에서 없는 워크스페이스 '${workspace}'를 사용합니다`);
            if (!Object.hasOwn(scripts, run.script)) {
              throw new Error(`${label}: ${jobName}에서 ${workspace}에 없는 npm script '${run.script}'를 호출합니다`);
            }
          }
        }
        for (const target of [...localNodeTargetsIn(step.run), ...localShellTargetsIn(step.run)]) {
          if (target.startsWith('$')) continue;
          if (!existsSync(resolve(base, target))) {
            throw new Error(`${label}: ${jobName}에서 없는 로컬 실행 파일 '${target}'을 호출합니다`);
          }
        }
      }
    }
  }
  return { jobs: Object.keys(workflow.jobs).length, steps };
}

function main() {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const catalog = { root: packageJson.scripts ?? {}, workspaces: new Map() };
  const packageEntries = [{ label: 'package.json', base: root, scripts: catalog.root }];
  for (const base of ['apps', 'packages']) {
    for (const name of readdirSync(resolve(root, base))) {
      const manifest = resolve(root, base, name, 'package.json');
      if (!existsSync(manifest)) continue;
      const workspace = JSON.parse(readFileSync(manifest, 'utf8'));
      catalog.workspaces.set(workspace.name, workspace.scripts ?? {});
      packageEntries.push({ label: `${base}/${name}/package.json`, base: dirname(manifest), scripts: workspace.scripts ?? {} });
    }
  }
  const packageTargets = validatePackageScriptTargets(packageEntries);
  const directory = resolve(root, '.github/workflows');
  const files = readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => resolve(directory, name))
    .sort();
  if (files.length === 0) throw new Error('검사할 GitHub Actions 워크플로가 없습니다');

  let jobs = 0;
  let steps = 0;
  for (const file of files) {
    const result = validateWorkflow(readFileSync(file, 'utf8'), catalog, relative(root, file));
    jobs += result.jobs;
    steps += result.steps;
  }
  console.log(`✔ GitHub Actions ${files.length}개 · 잡 ${jobs}개 · 단계 ${steps}개 통과`);
  console.log(`✔ package script 로컬 실행 파일/경로 ${packageTargets.checked}개 통과 · 생성물 ${packageTargets.skippedGenerated}개 제외`);
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
