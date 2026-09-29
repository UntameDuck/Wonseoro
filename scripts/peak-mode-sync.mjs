#!/usr/bin/env node
/**
 * Peak Mode 예약을 Git desired state 로 옮긴다 (T-M4-07, D-48 · ADR-0006).
 *
 *   node scripts/peak-mode-sync.mjs                 # 무엇이 바뀔지 보여 준다
 *   node scripts/peak-mode-sync.mjs --write         # overlay 를 고쳐 쓴다 (예약 워크플로가 쓴다)
 *   node scripts/peak-mode-sync.mjs --check         # 예약 문법 + overlay 가 예약과 맞는지 (CI)
 *   --now 2026-09-10T03:00:00Z                      # 기준 시각 (시험용)
 *   --schedule <path> --out <path>                  # 한 쌍만 (로컬 kind 시험)
 *
 * 쓰기 결과로 바뀐 파일 경로를 한 줄씩 stdout 에 낸다. 워크플로는 이 목록 밖의 변경을 거부한다.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  assertOverlayConsistent,
  parseSchedule,
  planPeakMode,
  renderOverlay,
} from './peak-mode/schedule.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
const nowText = arg('--now');
const nowMs = nowText ? Date.parse(nowText) : Date.now();
if (!Number.isFinite(nowMs)) throw new Error(`--now 를 해석할 수 없다: ${nowText}`);

function pairs() {
  const schedule = arg('--schedule');
  const out = arg('--out');
  if (schedule || out) {
    if (!schedule || !out) throw new Error('--schedule 과 --out 은 함께 준다');
    return [{ schedulePath: schedule, overlayPath: out, university: undefined }];
  }
  const root = 'deploy/universities';
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      schedulePath: join(root, entry.name, 'peak-schedule.yaml'),
      overlayPath: join(root, entry.name, 'peak-mode.yaml'),
      university: entry.name,
    }))
    .filter(({ schedulePath }) => existsSync(schedulePath));
}

const changed = [];
for (const { schedulePath, overlayPath, university } of pairs()) {
  const schedule = parseSchedule(readFileSync(schedulePath, 'utf8'), university);
  const current = existsSync(overlayPath)
    ? readFileSync(overlayPath, 'utf8').replace(/\r\n/g, '\n')
    : null;

  if (check) {
    if (current === null) throw new Error(`${overlayPath} 가 없다 — HelmRelease 가 이 파일을 읽는다`);
    const window = assertOverlayConsistent(schedule, current);
    console.error(`✔ ${schedule.university}: 예약 창 ${schedule.windows.length}개, overlay ${window ?? '평시'}`);
    continue;
  }

  const plan = planPeakMode(schedule, nowMs);
  const next = renderOverlay(schedule, plan);
  const label = plan.active ? `창 ${plan.window.id}` : '평시';
  if (next === current) {
    console.error(`= ${schedule.university}: ${label} (변경 없음)`);
    continue;
  }
  console.error(`→ ${schedule.university}: ${label}(으)로 바꾼다 (${basename(dirname(overlayPath))}/${basename(overlayPath)})`);
  if (write) writeFileSync(overlayPath, next);
  changed.push(overlayPath.replaceAll('\\', '/'));
}

for (const path of changed) console.log(path);
