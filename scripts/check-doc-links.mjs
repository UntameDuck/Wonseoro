// 저장소 Markdown의 로컬 파일 링크가 실제 경로를 가리키는지 검사한다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const ignoredDirectories = new Set(['.git', '.next', 'coverage', 'dist', 'node_modules', 'output']);

export function extractLocalTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith('<')) target = target.slice(1, target.indexOf('>'));
    else target = target.split(/\s+["']/)[0];
    if (!target || /^(?:https?:|mailto:|tel:|data:|codex:|app:)/i.test(target)) continue;
    targets.push(target);
  }
  return targets;
}

export function markdownFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...markdownFiles(resolve(directory, entry.name), base));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files.sort((left, right) => relative(base, left).localeCompare(relative(base, right), 'en'));
}

function withoutFragment(target) {
  const hash = target.indexOf('#');
  const path = hash >= 0 ? target.slice(0, hash) : target;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function githubSlug(heading) {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, (character) => character === '-' || character === '_' ? character : '')
    .replace(/\s/g, '-');
}

export function markdownAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = githubSlug(heading);
    const count = seen.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    seen.set(base, count + 1);
  }
  for (const match of markdown.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/gi)) anchors.add(match[1]);
  return anchors;
}

function fragmentOf(target) {
  const hash = target.indexOf('#');
  if (hash < 0) return '';
  try {
    return decodeURIComponent(target.slice(hash + 1));
  } catch {
    return target.slice(hash + 1);
  }
}

export function findBrokenLinks(repositoryRoot, files = markdownFiles(repositoryRoot)) {
  const problems = [];
  const prefix = `${resolve(repositoryRoot)}${sep}`.toLowerCase();
  for (const file of files) {
    const markdown = readFileSync(file, 'utf8');
    for (const target of extractLocalTargets(markdown)) {
      const localPath = withoutFragment(target);
      const destination = localPath ? resolve(dirname(file), localPath) : file;
      const normalized = destination.toLowerCase();
      if (normalized !== resolve(repositoryRoot).toLowerCase() && !normalized.startsWith(prefix)) {
        problems.push({ file, target, reason: '저장소 밖 경로' });
      } else if (!existsSync(destination)) {
        problems.push({ file, target, reason: '대상 없음' });
      } else if (target.endsWith('/') && !statSync(destination).isDirectory()) {
        problems.push({ file, target, reason: '디렉터리가 아님' });
      } else {
        const fragment = fragmentOf(target);
        if (fragment && destination.toLowerCase().endsWith('.md')) {
          const anchors = markdownAnchors(readFileSync(destination, 'utf8'));
          if (!anchors.has(fragment)) problems.push({ file, target, reason: '제목 앵커 없음' });
        }
      }
    }
  }
  return problems;
}

function main() {
  const files = markdownFiles(root);
  const problems = findBrokenLinks(root, files);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`✖ ${relative(root, problem.file)}: ${problem.target} — ${problem.reason}`);
    }
    throw new Error(`Markdown ${files.length}개에서 깨진 로컬 링크 ${problems.length}개를 찾았습니다`);
  }
  console.log(`✔ Markdown ${files.length}개 로컬 파일 링크 통과`);
}

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  try {
    main();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
