import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveDastOutput } from './dast-paths.mjs';

const root = path.resolve('fixture/repository');
const cwd = path.resolve('fixture/working');

test('인자가 없으면 저장소의 무시 경로를 쓴다', () => {
  assert.equal(resolveDastOutput([], root, cwd), path.join(root, '.cache/dast/reports-auth'));
});

test('상대 출력 경로는 현재 작업 폴더를 기준으로 해석한다', () => {
  assert.equal(resolveDastOutput(['--out=reports/zap'], root, cwd), path.join(cwd, 'reports/zap'));
});

test('절대 출력 경로를 유지한다', () => {
  const absolute = path.resolve('fixture/absolute-reports');
  assert.equal(resolveDastOutput([`--out=${absolute}`], root, cwd), absolute);
});

test('빈 출력 경로를 거절한다', () => {
  assert.throws(() => resolveDastOutput(['--out='], root, cwd), /보고서 폴더/);
});
