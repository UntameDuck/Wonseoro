// 시험·캡처가 쓰는 임시 작업 폴더 — 브라우저 프로필·실패 화면·시험용 PDF.
//
// 시스템 임시 폴더(os.tmpdir(), 이 PC 에서는 C 드라이브)에 두지 않는다. 브라우저 프로필 하나가 수십 MB 라
// 실행마다 쌓이면 C 드라이브를 채운다(2026-10-02 실제로 82개·3GB). 저장소 안 `.cache/`(git 제외)에 둔다.
//   WONSEORO_WORK_DIR=<폴더>  다른 곳에 두려면
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 이름별 작업 폴더를 만들고 경로를 돌려준다. 예: workDir('a11y') → <저장소>/.cache/a11y */
export function workDir(name) {
  const dir = path.join(process.env.WONSEORO_WORK_DIR ?? path.join(ROOT, '.cache'), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
