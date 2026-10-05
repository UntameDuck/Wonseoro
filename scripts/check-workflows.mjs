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
  return [...command.matchAll(/\bnode\s+(?!-)(['"]?)([^\s'"]+)\1/g)].map((match) => match[2]);
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
    if (job.uses) continue;
    if (!job['runs-on']) throw new Error(`${label}: ${jobName} 잡에 runs-on이 없습니다`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) throw new Error(`${label}: ${jobName} 잡에 steps가 없습니다`);
    for (const [index, step] of job.steps.entries()) {
      steps += 1;
      if (step.uses && !String(step.uses).includes('@')) {
        throw new Error(`${label}: ${jobName} ${index + 1}번째 uses에 버전이 없습니다`);
      }
      if (typeof step.run === 'string') {
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
        for (const target of localNodeTargetsIn(step.run)) {
          if (target.startsWith('$')) continue;
          if (!existsSync(resolve(repositoryRoot, target))) {
            throw new Error(`${label}: ${jobName}에서 없는 Node 실행 파일 '${target}'을 호출합니다`);
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
  for (const base of ['apps', 'packages']) {
    for (const name of readdirSync(resolve(root, base))) {
      const manifest = resolve(root, base, name, 'package.json');
      if (!existsSync(manifest)) continue;
      const workspace = JSON.parse(readFileSync(manifest, 'utf8'));
      catalog.workspaces.set(workspace.name, workspace.scripts ?? {});
    }
  }
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
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
