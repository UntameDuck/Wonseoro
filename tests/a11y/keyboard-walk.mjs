// T-M5-40 키보드 전용 접수 완주 — 마우스 없이 접수 홈 → 공통원서 → 원서 1~6단계 → 접수증까지.
//
// 사용: node tests/a11y/keyboard-walk.mjs [--width=1280] [--height=900] [--browser=chrome|edge]
//   --width=640  1280 화면을 200% 로 확대한 것과 같은 CSS 폭 (T-M5-43)
//   --width=320  가장 좁은 휴대전화 폭 (T-M5-44)
//
// 하는 일
//   - 요소를 click() 하지 않는다. Tab·Shift+Tab 으로 포커스를 옮기고 Enter·Space 로 누른다. 글자는 입력기 경로(insertText)
//   - 파일 선택은 Enter 로 연 파일 대화상자에 파일을 넘긴다 — 사람이 대화상자에서 고르는 자리다
//   - Tab 으로 지나간 모든 자리에서 포커스 표시가 보이는지, 화면 안에 있는지, 위로 거슬러 가지 않는지 본다 (T-M5-41)
//   - 누른 버튼이 사라지는 전환(단계 이동·검증 오류·취소 칸) 뒤 포커스가 문서 처음으로 떨어지지 않는지 본다
//   - 화면마다 가로 스크롤이 생기지 않는지 본다 (T-M5-43·44)
//
// 서버: 화면 캡처와 같은 전용 DB(ui-shots-pg :5497)·포트(중앙 3100 · 대학 3101 · 서류 워커 3102 · 지원자 웹 4001).
// 띄우는 순서는 docs/screenshots/README.md 「다시 찍기」 1~3. 실행마다 새 지원자를 DB 에 넣는다(한 전형에 원서는 하나).
// 결과는 tests/a11y/results/keyboard-walk-<브라우저>-<폭>-<시각>.json
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSERS, focusInfo, launch, press, selectAll, sleep, typeText } from './helpers/browser.mjs';
import { samplePdf } from './helpers/sample.mjs';
import { axAudit, axFocused } from './helpers/ax.mjs';

const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const WIDTH = Number(arg('width', '1280'));
const HEIGHT = Number(arg('height', '900'));
const BROWSER = arg('browser', 'chrome');
const WEB = 'http://localhost:4001';
const PG = 'ui-shots-pg';

/* ── 준비: 새 지원자 ─────────────────────────────────────────────────── */

const applicant = { applicantId: randomUUID(), subjectToken: `subj-kbd-${Date.now()}` };
execFileSync('docker', [
  'exec', PG, 'psql', '-q', '-U', 'wonseoro', '-d', 'univ_a', '-v', 'ON_ERROR_STOP=1', '-c',
  `INSERT INTO kadmission.applicant (id, subject_token, pii_ciphertext, pii_key_version)
   VALUES ('${applicant.applicantId}', '${applicant.subjectToken}', '\\x00', 'v1')`,
]);

const b = await launch({ width: WIDTH, height: HEIGHT, executable: BROWSERS[BROWSER] ?? BROWSER });
const started = Date.now();

/* ── 기록 ────────────────────────────────────────────────────────────── */

const screens = [];
let current = null;
const problems = [];
let keys = 0;

function problem(what) {
  problems.push(`${current?.name ?? '-'}: ${what}`);
  console.error(`  ✘ ${what}`);
}

/** 새 화면에 들어왔다. 개발 서버 표시(Next.js 배지)는 화면의 일부가 아니라 걷어낸다. 가로 스크롤을 본다. */
async function screen(name, readyText) {
  if (readyText) await waitText(readyText, 60_000);
  await sleep(400);
  await b.evaluate(`document.querySelectorAll('nextjs-portal').forEach((e) => e.remove())`);
  current = { name, url: await b.evaluate('location.pathname'), stops: [], horizontalScroll: false };
  screens.push(current);
  await checkOverflow();
  // 스크린리더 재료 — 이름 없는 칸·오류 설명·단계·큰 제목·카운트다운 알림 (T-M5-42)
  const ax = await axAudit(b);
  for (const x of ax.problems) problem(`스크린리더: ${x}`);
  current.title = ax.title;
  console.log(`▶ ${name}`);
}

/** 오류 링크로 간 칸 — 스크린리더가 "올바르지 않음" 과 오류 문장을 읽어야 한다 (T-M5-42) */
async function expectErrorSpoken(message) {
  const say = await axFocused(b);
  if (!say?.states.includes('올바르지 않음')) problem(`오류 칸을 "올바르지 않음" 으로 알리지 않는다 — ${say?.text}`);
  if (!say?.description.includes(message)) problem(`오류 칸의 설명에 오류 문장이 없다 — ${say?.text}`);
  return say;
}

/** 가로 스크롤 — 문서 폭이 화면보다 넓으면 좁은 화면·확대에서 옆으로 밀어야 읽힌다 (KWCAG 1.4.10 재배치) */
async function checkOverflow() {
  const o = await b.evaluate(`(() => {
    const d = document.documentElement;
    const over = d.scrollWidth - d.clientWidth;
    if (over <= 0) return null;
    const wide = [...document.querySelectorAll('main *, header *, footer *')]
      .filter((e) => e.getBoundingClientRect().right > d.clientWidth + 1)
      .slice(0, 3)
      .map((e) => e.tagName + (e.id ? '#' + e.id : '') + ' ' + (e.textContent || '').trim().slice(0, 30));
    return { over, wide };
  })()`);
  if (o && !current.horizontalScroll) {
    current.horizontalScroll = true;
    problem(`가로 스크롤 ${o.over}px — ${o.wide.join(' | ')}`);
  }
}

async function waitText(t, timeout = 30_000) {
  await b.waitFor(`!!document.body && document.body.innerText.includes(${JSON.stringify(t)})`, `"${t}"`, timeout);
}

/** 지나간 자리를 기록하고 포커스 표시·위치·순서를 본다. */
function record(info) {
  current.stops.push({ name: info.name, tag: info.tag, ...(info.type ? { type: info.type } : {}), visible: info.visible });
  if (info.body) return;
  if (!info.visible || !info.focusVisible) problem(`포커스 표시가 보이지 않는다 — ${info.tag} "${info.name}"`);
  if (!info.inView) problem(`포커스된 요소가 화면 밖에 있다 — ${info.tag} "${info.name}"`);
}

/**
 * 원하는 요소에 닿을 때까지 Tab 을 누른다. 닿지 못하면 키보드로 갈 수 없는 것이다.
 * @param {(i: any) => boolean} match
 */
async function tabTo(what, match, { max = 60, shift = false } = {}) {
  let prevTop = null;
  for (let i = 0; i < max; i++) {
    await press(b, 'Tab', { shift });
    keys += 1;
    const info = await focusInfo(b);
    record(info);
    // 순서 — 다음 자리가 위로 거슬러 가면 읽는 순서와 다르다. 문서 끝에서 처음으로 돌아가는 것은 제외한다
    // 같은 줄(세로로 겹친다)이면 거스른 것이 아니다. 다음 자리가 앞 자리보다 통째로 위에 있을 때만 본다
    const box = await b.evaluate(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; })()`);
    const top = box?.top ?? null;
    if (!shift && prevTop !== null && box !== null && box.bottom <= prevTop && !info.body) {
      const wrapped = await b.evaluate(`document.activeElement.closest('header') !== null || document.activeElement.classList.contains('krds-skip')`);
      if (!wrapped) problem(`포커스 순서가 위로 거슬러 간다 — "${info.name}"`);
    }
    prevTop = info.body ? null : top;
    if (match(info)) return info;
  }
  throw new Error(`키보드로 닿지 못했다: ${what} (Tab ${max}번)`);
}

const named = (name, extra = {}) => (i) =>
  i.name === name && (!extra.tag || i.tag === extra.tag) && (!extra.type || i.type === extra.type);

async function activate(key = 'Enter') {
  await press(b, key);
  keys += 1;
}

/** 전환 뒤 포커스가 여기에 와 있어야 한다 — 누른 버튼이 사라져도 문서 처음으로 떨어지지 않는다. */
async function expectFocus(what, check) {
  for (let i = 0; i < 20; i++) {
    const info = await focusInfo(b);
    if (check(info)) {
      record(info);
      return info;
    }
    await sleep(150);
  }
  const info = await focusInfo(b);
  problem(`${what} — 포커스가 ${info.body ? '문서 처음으로 떨어졌다' : `"${info.name}" 에 있다`}`);
  return info;
}
const onId = (id) => (i) => i.id === id;

/* ── 흐름 ────────────────────────────────────────────────────────────── */

async function walk() {
  // 1. 접수 홈 — 첫 Tab 은 본문 바로가기, 누르면 다음 Tab 이 본문 안이다
  await b.send('Page.navigate', { url: `${WEB}/` });
  await screen('접수 홈', '원서 작성 시작');
  const skip = await tabTo('본문 바로가기', named('본문 바로가기'), { max: 1 });
  if (!skip.visible) problem('본문 바로가기가 포커스를 받아도 보이지 않는다');
  await activate();
  const first = await tabTo('본문 첫 칸', (i) => !i.body, { max: 3 });
  if (!first.inMain) problem(`본문 바로가기 뒤 첫 Tab 이 본문 밖이다 — "${first.name}"`);

  await tabTo('지원자 식별자', named('지원자 식별자', { tag: 'INPUT' }));
  await typeText(b, applicant.applicantId);
  await tabTo('공통원서 가명 토큰', named('공통원서 가명 토큰', { tag: 'INPUT' }));
  await typeText(b, applicant.subjectToken);

  // 2. 공통원서 — 잘못된 이메일로 저장해 오류 요약 → 칸 이동을 키보드로 한다
  await tabTo('공통원서 작성 링크', named('공통원서 작성·제공 동의', { tag: 'A' }));
  await activate();
  await b.waitFor(`location.pathname === '/profile'`, '공통원서 이동');
  await screen('공통원서', '기본 정보');
  await b.waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === '저장' && !x.disabled)`, '공통원서 불러오기');
  for (const [label, value] of [
    ['출신 고등학교', '한국고등학교'],
    ['졸업(예정) 연도', '2027'],
    ['이메일', 'applicant-at-example.com'],
    ['휴대전화', '010-1234-5678'],
  ]) {
    await tabTo(label, named(label, { tag: 'INPUT', type: label === '이메일' ? 'email' : undefined }));
    await typeText(b, value);
  }
  for (const label of ['출신 고등학교', '졸업(예정) 연도']) {
    await tabTo(`${label} 제공 동의`, named(label, { type: 'checkbox' }));
    await activate(' ');
    const after = await focusInfo(b);
    if (!after.checked) problem(`Space 로 체크되지 않는다 — ${label} 제공 동의`);
  }
  await tabTo('저장', named('저장', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('저장 검증 오류 뒤 오류 요약', (i) => i.role === 'alert');
  const link = await tabTo('오류 요약의 항목', (i) => i.tag === 'A', { max: 3 });
  await activate();
  await expectFocus(`오류 요약 "${link.name}" → 칸`, onId('field-contactEmail'));
  await expectErrorSpoken(link.name);
  await selectAll(b);
  await typeText(b, 'applicant@example.com');
  await tabTo('저장', named('저장', { tag: 'BUTTON' }));
  await activate();
  await waitText('저장했습니다');

  // 3. 접수 홈으로 — 경로의 "홈"
  await tabTo('홈', named('홈', { tag: 'A' }), { shift: true, max: 40 });
  await activate();
  await b.waitFor(`location.pathname === '/'`, '홈 이동');
  await screen('접수 홈 (본인확인 뒤)', '원서 작성 시작');
  await b.waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === '원서 작성 시작' && !x.disabled)`, '세션 복원');
  await tabTo('원서 작성 시작', named('원서 작성 시작', { tag: 'BUTTON' }));
  await activate();
  await b.waitFor(`location.pathname.startsWith('/apply/')`, '원서 화면 이동', 60_000);
  applicationId = await b.evaluate(`location.pathname.split('/')[2]`);

  // 4. 1단계 — 취소 칸을 열고 닫아 포커스가 돌아오는지 본다
  await screen('원서 1단계 공통정보', '1. 공통정보');
  await waitText('출신 고등학교');
  await tabTo('이 원서 취소하기', named('이 원서 취소하기', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('취소 칸을 연 뒤 취소 사유', onId('cancel-reason'));
  await tabTo('그만두기', named('그만두기', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('취소 칸을 닫은 뒤', onId('cancel-open'));
  await tabTo('다음 단계', named('다음 단계', { tag: 'BUTTON' }), { shift: true });
  await activate();
  await expectFocus('2단계로 옮긴 뒤 단계 제목', onId('step-title'));

  // 5. 2단계
  await screen('원서 2단계 대학·전형', '2. 대학·전형');
  await tabTo('다음 단계', named('다음 단계', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('3단계로 옮긴 뒤 단계 제목', onId('step-title'));

  // 6. 3단계 — 자기소개를 비워 두고 간다(검증 오류를 키보드로 고치려고)
  await screen('원서 3단계 추가정보', '3. 추가정보');
  await tabTo('내신 성적', named('내신 성적', { tag: 'INPUT' }));
  await typeText(b, '1.8');
  await tabTo('다음 단계', named('다음 단계', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('4단계로 옮긴 뒤 단계 제목', onId('step-title'));

  // 7. 4단계 — 파일 선택 버튼을 Enter 로, 열린 대화상자에 파일을 넘긴다
  await screen('원서 4단계 서류', '4. 서류');
  await b.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = new Promise((res) => b.on('Page.fileChooserOpened', res));
  await tabTo('파일 선택', named('파일 선택', { tag: 'BUTTON' }));
  await activate();
  const opened = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!opened) throw new Error('Enter 로 파일 대화상자가 열리지 않았다');
  await b.send('DOM.setFileInputFiles', { files: [samplePdf()], backendNodeId: opened.backendNodeId });
  await b.send('Page.setInterceptFileChooserDialog', { enabled: false });
  await waitText('업로드·검사 완료', 60_000); // 검사 중이면 화면이 3초마다 다시 읽는다
  await tabTo('검토 단계로', named('검토 단계로', { tag: 'BUTTON' }));
  await activate();

  // 8. 검증 오류 — 오류 요약이 포커스를 받고, 항목 링크가 3단계 그 칸으로 데려간다
  await expectFocus('검토 전 검증 오류 뒤 오류 요약', (i) => i.role === 'alert');
  await screen('검토 전 검증 오류', '입력을 확인해 주십시오');
  const issue = await tabTo('오류 요약의 항목', (i) => i.tag === 'A', { max: 3 });
  await activate();
  await expectFocus(`오류 요약 "${issue.name}" → 3단계 칸`, onId('field-selfIntro'));
  await expectErrorSpoken(issue.name);
  await typeText(b, '공공 서비스의 장애 대응에 관심이 있어 분산 시스템을 공부하고 있습니다.');
  await tabTo('다음 단계', named('다음 단계', { tag: 'BUTTON' }));
  await activate();
  await expectFocus('4단계로 옮긴 뒤 단계 제목', onId('step-title'));
  await tabTo('검토 단계로', named('검토 단계로', { tag: 'BUTTON' }));
  await activate();

  // 9. 5단계 — 확인 체크는 Space, 결제는 Enter
  await waitText('결제가 확인되면 바로 접수가 완료됩니다', 30_000);
  await expectFocus('5단계로 옮긴 뒤 단계 제목', onId('step-title'));
  await screen('원서 5단계 검토·결제');
  const confirm = '결제 후에는 원서를 수정하거나 취소할 수 없다는 것을 확인했습니다.';
  await tabTo('결제 전 확인 체크', named(confirm, { type: 'checkbox' }));
  await activate(' ');
  if (!(await focusInfo(b)).checked) problem('Space 로 결제 전 확인이 체크되지 않는다');
  await tabTo('전형료 결제하고 접수', named('전형료 결제하고 접수', { tag: 'BUTTON' }));
  await activate();

  // 10. 6단계 접수 완료 → 접수증
  await waitText('접수가 완료되었습니다', 60_000);
  await expectFocus('접수 완료 뒤 단계 제목', onId('step-title'));
  await screen('접수 완료');
  const number = await b.evaluate(`(() => { const dt = [...document.querySelectorAll('dt')].find((d) => d.textContent === '접수번호'); return dt?.nextElementSibling?.textContent ?? null; })()`);
  await tabTo('접수증 보기·인쇄', named('접수증 보기·인쇄', { tag: 'A' }));
  await activate();
  await b.waitFor(`location.pathname.startsWith('/receipt/')`, '접수증 이동');
  await screen('접수증', '접수번호');
  await tabTo('인쇄', named('인쇄', { tag: 'BUTTON' }));
  return number;
}

let applicationNumber = null;
let applicationId = null;
let fatal = null;
try {
  applicationNumber = await walk();
} catch (err) {
  fatal = err.message;
  console.error('✘', err.message);
  const r = await b.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (r) writeFileSync(path.join(os.tmpdir(), 'wonseoro-a11y', `fail-keyboard-${WIDTH}.png`), Buffer.from(r.data, 'base64'));
} finally {
  b.close();
}

const result = {
  test: 'T-M5-40 키보드 전용 접수 완주 (+ T-M5-41 포커스 · T-M5-42 스크린리더 재료 · T-M5-43/44 가로 스크롤)',
  environment: '축소 환경 — 로컬 전용 DB(ui-shots-pg)·개발 서버(next dev)·Mock PG·Mock 검사 엔진',
  browser: b.browser,
  viewport: { width: WIDTH, height: HEIGHT },
  at: new Date(started).toISOString(),
  seconds: Math.round((Date.now() - started) / 1000),
  completed: !fatal && applicationNumber !== null,
  applicationNumber,
  // 개발용 시험 지원자 — 실제 사람이 아니다. focus-sweep 이 같은 원서의 접수 완료 화면을 다시 본다
  applicant,
  applicationId,
  keyPresses: keys,
  mouseEvents: 0,
  fatal,
  problems,
  screens,
};
const dir = path.resolve('tests/a11y/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `keyboard-walk-${BROWSER}-${WIDTH}-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.completed && problems.length === 0 ? '✔' : '✘'} 완주 ${result.completed ? '성공' : '실패'} · 접수번호 ${applicationNumber ?? '-'} · 키 ${keys}번 · 문제 ${problems.length}건 → ${path.relative(process.cwd(), file)}`);
process.exitCode = result.completed && problems.length === 0 ? 0 : 1;
