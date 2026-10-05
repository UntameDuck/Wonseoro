// 공개 README와 작업 문서의 전체·완료·잔여 태스크 수가 어긋나지 않게 한다.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const STATUS_PATTERN = /\*\*(\d+)개(?:\s+태스크)?\s+중\s+(\d+)개 완료,\s*(\d+)개 남음\*\*/gu;
const MILESTONE_PATTERN = /^\|\s*(M\d(?:~M\d)?)\b[^|]*\|\s*\*{0,2}(\d+)\/(\d+)/gmu;

export function extractStatus(markdown, label = '문서') {
  const matches = [...markdown.matchAll(STATUS_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`${label}: '**전체 개수 중 완료 개수, 잔여 개수**' 상태 요약이 정확히 하나여야 합니다(현재 ${matches.length}개)`);
  }
  return {
    total: Number(matches[0][1]),
    completed: Number(matches[0][2]),
    remaining: Number(matches[0][3]),
  };
}

export function validateStatuses(records) {
  if (records.length < 2) throw new Error('비교할 상태 문서가 둘 이상이어야 합니다.');
  for (const { label, status } of records) {
    if (status.total !== status.completed + status.remaining) {
      throw new Error(`${label}: 전체 ${status.total} != 완료 ${status.completed} + 잔여 ${status.remaining}`);
    }
  }
  const expected = records[0];
  for (const record of records.slice(1)) {
    if (JSON.stringify(record.status) !== JSON.stringify(expected.status)) {
      throw new Error(`${record.label}: ${JSON.stringify(record.status)} != ${expected.label}: ${JSON.stringify(expected.status)}`);
    }
  }
  return expected.status;
}

export function extractMilestones(markdown, label = '문서') {
  const milestones = [...markdown.matchAll(MILESTONE_PATTERN)].map((match) => ({
    label: match[1], completed: Number(match[2]), total: Number(match[3]),
  }));
  if (milestones.length === 0) throw new Error(`${label}: 마일스톤 진행 표가 없습니다.`);
  const labels = milestones.map((milestone) => milestone.label);
  if (new Set(labels).size !== labels.length) throw new Error(`${label}: 마일스톤 행이 중복됐습니다.`);
  return milestones;
}

export function validateMilestoneTotal(milestones, status, label = '문서') {
  const sum = milestones.reduce((acc, milestone) => ({
    completed: acc.completed + milestone.completed,
    total: acc.total + milestone.total,
  }), { completed: 0, total: 0 });
  if (sum.completed !== status.completed || sum.total !== status.total) {
    throw new Error(`${label}: 마일스톤 합 ${sum.completed}/${sum.total} != 상태 ${status.completed}/${status.total}`);
  }
  return sum;
}

export function compareMilestones(reference, grouped, label = '문서') {
  const byLabel = new Map(reference.map((milestone) => [milestone.label, milestone]));
  const covered = new Set();
  for (const milestone of grouped) {
    const range = milestone.label.match(/^M(\d+)~M(\d+)$/u);
    const labels = range
      ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => `M${Number(range[1]) + index}`)
      : [milestone.label];
    const parts = labels.map((name) => byLabel.get(name));
    if (parts.some((part) => !part)) throw new Error(`${label}: ${milestone.label}에 대응하는 기준 마일스톤이 없습니다.`);
    const expected = parts.reduce((acc, part) => ({
      completed: acc.completed + part.completed,
      total: acc.total + part.total,
    }), { completed: 0, total: 0 });
    if (milestone.completed !== expected.completed || milestone.total !== expected.total) {
      throw new Error(`${label}: ${milestone.label} ${milestone.completed}/${milestone.total} != 기준 ${expected.completed}/${expected.total}`);
    }
    labels.forEach((name) => covered.add(name));
  }
  if (covered.size !== reference.length) throw new Error(`${label}: 기준 마일스톤 일부가 빠졌습니다.`);
}

function main() {
  const files = ['README.md', 'docs/README.md', 'docs/03-next-steps.md'];
  const sources = new Map(files.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]));
  const records = files.map((path) => ({ label: path, status: extractStatus(sources.get(path), path) }));
  const status = validateStatuses(records);
  const rootMilestones = extractMilestones(sources.get('README.md'), 'README.md');
  const docsMilestones = extractMilestones(sources.get('docs/README.md'), 'docs/README.md');
  validateMilestoneTotal(rootMilestones, status, 'README.md');
  validateMilestoneTotal(docsMilestones, status, 'docs/README.md');
  compareMilestones(rootMilestones, docsMilestones, 'docs/README.md');
  console.log(`✔ 상태 요약 ${records.length}개 정합: 전체 ${status.total} · 완료 ${status.completed} · 남음 ${status.remaining}`);
  console.log(`✔ 마일스톤 표 정합: README ${rootMilestones.length}행 · docs/README ${docsMilestones.length}행`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main();
