// T-M5-41 Visible Focus / Focus Order — 모든 화면을 Tab 으로 한 바퀴 돈다.
//
// 사용: node tests/a11y/focus-sweep.mjs <applicant|admin> [--width=1280] [--browser=chrome|edge]
//   applicant  지원자 웹(:4001) — 접수 홈·공통원서·내 원서·원서 1~6단계·접수증·없는 화면·장애 안내
//   admin      입학처 콘솔(:4101) — 첫 화면·설정 승인(검토 열기)·마감·대조·증적·보존기간·없는 화면
//
// 화면마다 문서 처음에서 Tab 을 눌러 끝을 지나 다시 처음으로 돌아올 때까지 간다. 각 자리에서 본다.
//   - 포커스 표시가 보이는가 — 테두리 2px 이상, 키보드 포커스 표시(:focus-visible)
//   - 표시가 배경과 구별되는가 — 테두리 색과 그 뒤 배경의 명암비 3:1 이상 (KWCAG·WCAG 1.4.11)
//   - 순서가 읽는 순서인가 — 위로 거슬러 가지 않는다. tabindex 양수가 없다
//   - 갇히지 않는가 — 같은 자리를 끝없이 돌지 않고 문서 끝을 지나 빠져나온다
//   - 빠진 것이 없는가 — 화면에 보이는 누를 수 있는 것(링크·버튼·입력칸·접힌 내용)에 모두 닿는다
//
// 서버는 keyboard-walk.mjs 와 같다(전용 DB·포트). admin 은 콘솔(shots-admin)이 떠 있어야 하고, prepare.sh config 로
// 설정 초안이 있으면 검토 화면까지 본다. 결과는 tests/a11y/results/focus-sweep-<단계>-<브라우저>-<폭>-<시각>.json
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BROWSERS, focusInfo, launch, press, sleep, typeText } from './helpers/browser.mjs';
import { samplePdf } from './helpers/sample.mjs';
import { axAudit, axFocused } from './helpers/ax.mjs';

const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const PHASE = process.argv.slice(2).find((a) => !a.startsWith('--'));
const WIDTH = Number(arg('width', '1280'));
const HEIGHT = Number(arg('height', '900'));
const BROWSER = arg('browser', 'chrome');
const WEB = 'http://localhost:4001';
const ADMIN = 'http://localhost:4101';
const API = 'http://localhost:3101';
const PG = 'ui-shots-pg';
if (!['applicant', 'admin'].includes(PHASE ?? '')) {
  console.error('사용: node tests/a11y/focus-sweep.mjs <applicant|admin> [--width=1280] [--browser=chrome|edge]');
  process.exit(2);
}

const b = await launch({ width: WIDTH, height: HEIGHT, executable: BROWSERS[BROWSER] ?? BROWSER, port: 9335 });
const started = Date.now();
const screens = [];
const problems = [];

/* ── 한 화면 돌기 ────────────────────────────────────────────────────── */

/** 지금 포커스 자리의 표시·명암비·위치. 처음 본 자리에는 번호를 붙인다(갇힘·빠짐 판정). */
const STOP = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  const rgb = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  // 테두리는 요소 바깥(offset 2px)에 그려진다 — 그 뒤 배경은 부모 쪽에서 처음 만나는 불투명 배경이다
  let bg = null;
  for (let n = el.parentElement; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) bg = c; }
  bg = bg ?? { r: 255, g: 255, b: 255 };
  const cs = getComputedStyle(el);
  const oc = rgb(cs.outlineColor);
  const L1 = oc ? lum(oc) : 0, L2 = lum(bg);
  const contrast = oc ? (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) : 0;
  const seen = el.dataset.sweep !== undefined;
  if (!seen) el.dataset.sweep = String(document.querySelectorAll('[data-sweep]').length);
  const r = el.getBoundingClientRect();
  const clean = (t) => (t || '').replace('필수 입력', '').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim();
  return {
    n: Number(el.dataset.sweep),
    seen,
    tag: el.tagName,
    name: clean(el.getAttribute('aria-label') || (el.labels && el.labels.length ? el.labels[0].textContent : '') || el.innerText || el.value || '').slice(0, 60),
    outline: cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) : 0,
    focusVisible: el.matches(':focus-visible'),
    contrast: Math.round(contrast * 100) / 100,
    top: Math.round(r.top + scrollY),
    bottom: Math.round(r.bottom + scrollY),
    left: Math.round(r.left + scrollX),
    inView: r.bottom > 0 && r.top < innerHeight,
    header: !!el.closest('header') || el.classList.contains('krds-skip'),
  };
})()`;

/** 화면에 보이는데 Tab 으로 닿지 않은 누를 수 있는 것, 그리고 tabindex 양수 */
const MISSED = `(() => {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[aria-hidden=true]') && !(e.closest('details:not([open])') && e.tagName !== 'SUMMARY'); };
  const missed = [...document.querySelectorAll(sel)].filter((e) => shown(e) && e.dataset.sweep === undefined && !e.closest('nextjs-portal'))
    .map((e) => e.tagName + ' "' + (e.innerText || e.getAttribute('aria-label') || e.name || '').trim().slice(0, 40) + '"');
  const positive = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).map((e) => e.tagName);
  return { missed, positive };
})()`;

async function sweep(name) {
  // 화면이 다 그려진 뒤에 돈다 — 불러오는 중에 돌면 늦게 나타난 링크를 "닿지 않는다" 로 센다
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '불러오기', 15_000).catch(() => {});
  await sleep(500);
  await b.evaluate(`(() => {
    document.querySelectorAll('nextjs-portal').forEach((e) => e.remove());
    document.querySelectorAll('[data-sweep]').forEach((e) => delete e.dataset.sweep);
    window.scrollTo(0, 0);
    // 문서 처음에서 시작한다. blur() 만 하면 Tab 이 방금 포커스가 있던 자리(단계 제목 등) 다음부터 간다 —
    // 문서 맨 앞에 Tab 순서 밖의 표지를 두고 거기에 포커스한다
    const start = document.createElement('span');
    start.id = 'a11y-sweep-start';
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
  })()`);
  const screen = { name, url: await b.evaluate('location.pathname'), stops: [], problems: [] };
  const bad = (what) => {
    screen.problems.push(what);
    problems.push(`${name}: ${what}`);
    console.error(`  ✘ ${what}`);
  };
  let prev = null;
  let left = false;
  let inside = 0;
  for (let i = 0; i < 200; i++) {
    await press(b, 'Tab');
    const s = await b.evaluate(STOP);
    if (s.body) {
      if (screen.stops.length > 0) {
        left = true;
        break;
      }
      continue;
    }
    if (s.seen && prev && s.n === prev.n && ++inside <= 10) {
      // 같은 칸 안에서 Tab 이 움직인다 — 날짜·시각 칸은 연·월·일·시·분을 Tab 으로 옮긴다. 갇힌 것이 아니다
      continue;
    }
    inside = 0;
    if (s.seen) {
      // 끝을 지나 처음으로 돌아왔다(브라우저 밖을 거치지 않는 경우) — 첫 자리면 한 바퀴, 아니면 갇힘
      if (s.n === 0) left = true;
      else bad(`포커스가 갇힌다 — "${s.name}" 로 되돌아온다`);
      break;
    }
    // 스크린리더가 이 자리에서 읽을 재료 — 역할·이름·필수·오류·설명 (T-M5-42)
    const say = await axFocused(b);
    screen.stops.push({ tag: s.tag, name: s.name, outline: s.outline, contrast: s.contrast, say: say?.text ?? '' });
    if (s.outline < 2 || !s.focusVisible) bad(`포커스 표시가 보이지 않는다 — ${s.tag} "${s.name}"`);
    else if (s.contrast < 3) bad(`포커스 표시 명암비 ${s.contrast}:1 (3:1 미만) — ${s.tag} "${s.name}"`);
    if (!s.inView) bad(`포커스된 요소가 화면 밖 — ${s.tag} "${s.name}"`);
    // 같은 줄(세로로 겹친다)이면 거스른 것이 아니다. 다음 자리가 앞 자리보다 통째로 위에 있을 때만 본다
    if (prev && s.bottom <= prev.top && !(s.header && !prev.header)) bad(`순서가 위로 거슬러 간다 — "${prev.name}" 다음 "${s.name}"`);
    prev = s;
  }
  if (!left) bad('Tab 200번 안에 문서 끝을 지나지 못했다');
  await b.evaluate(`document.getElementById('a11y-sweep-start')?.remove()`);
  const m = await b.evaluate(MISSED);
  for (const x of m.missed) bad(`Tab 으로 닿지 않는다 — ${x}`);
  if (m.positive.length) bad(`tabindex 양수 ${m.positive.length}개 — 읽는 순서를 흐트러뜨린다`);
  const ax = await axAudit(b);
  for (const x of ax.problems) bad(`스크린리더: ${x}`);
  screen.title = ax.title;
  screen.liveRegions = ax.liveRegions;
  screens.push(screen);
  console.log(`${screen.problems.length ? '✘' : '✔'} ${name} — Tab 자리 ${screen.stops.length}개`);
}

async function go(url, readyText) {
  await b.send('Page.navigate', { url });
  await b.waitFor(`document.readyState === 'complete'`, `로드 ${url}`);
  if (readyText) await b.waitFor(`!!document.body && document.body.innerText.includes(${JSON.stringify(readyText)})`, `"${readyText}"`, 60_000);
}

/** 키보드로 이름이 맞는 자리까지 가서 누른다 — 화면 상태를 바꿀 때도 마우스를 쓰지 않는다. */
async function keyTo(name, key = 'Enter', max = 80) {
  for (let i = 0; i < max; i++) {
    await press(b, 'Tab');
    const f = await focusInfo(b);
    if (f.name === name) {
      await press(b, key);
      return;
    }
  }
  throw new Error(`키보드로 닿지 못했다: ${name}`);
}

/* ── 지원자 웹 ───────────────────────────────────────────────────────── */

function newApplicant() {
  const a = { applicantId: randomUUID(), subjectToken: `subj-sweep-${Date.now()}` };
  execFileSync('docker', [
    'exec', PG, 'psql', '-q', '-U', 'wonseoro', '-d', 'univ_a', '-v', 'ON_ERROR_STOP=1', '-c',
    `INSERT INTO kadmission.applicant (id, subject_token, pii_ciphertext, pii_key_version)
     VALUES ('${a.applicantId}', '${a.subjectToken}', '\\x00', 'v1')`,
  ]);
  return a;
}

/** 준비용 — 화면이 아니라 API 로 원서를 만든다(돌아볼 화면을 만드는 것이지 시험하는 흐름이 아니다). */
async function createApplication(a) {
  const h = { 'x-applicant-id': a.applicantId, 'x-subject-token': a.subjectToken };
  const cycle = await (await fetch(`${API}/api/v1/admission-cycles/current`, { headers: h })).json();
  const types = await (await fetch(`${API}/api/v1/admission-types?cycleId=${cycle.id}`, { headers: h })).json();
  const depts = await (await fetch(`${API}/api/v1/departments?cycleId=${cycle.id}`, { headers: h })).json();
  const r = await fetch(`${API}/api/v1/applications`, {
    method: 'POST',
    headers: { ...h, 'content-type': 'application/json', 'idempotency-key': `sweep-${randomUUID()}` },
    body: JSON.stringify({ cycleId: cycle.id, admissionTypeId: types[0].id, departmentId: depts[0].id }),
  });
  if (!r.ok) throw new Error(`원서 만들기 ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

async function applicant() {
  await go(`${WEB}/`, '원서 작성 시작');
  await sweep('접수 홈 (본인확인 전)');
  await go(`${WEB}/dashboard`, '본인확인');
  await sweep('내 원서 (본인확인 전)');
  await go(`${WEB}/no-such-page`, '찾을 수 없는 화면');
  await sweep('없는 화면');

  const a = newApplicant();
  const applicationId = await createApplication(a);
  await b.evaluate(`sessionStorage.setItem('wonseoro.dev.session', ${JSON.stringify(JSON.stringify({ ...a, applicationId }))})`);
  await go(`${WEB}/`, '원서 작성 시작');
  await sweep('접수 홈 (본인확인 뒤)');
  await go(`${WEB}/profile`, '기본 정보');
  await sweep('공통원서');
  await keyTo('저장');
  await b.waitFor(`document.body.innerText.includes('입력을 확인해 주십시오') || document.body.innerText.includes('저장했습니다')`, '저장 결과');
  await sweep('공통원서 (저장 결과)');

  await go(`${WEB}/apply/${applicationId}`, '1. 공통정보');
  await sweep('원서 1단계');
  await keyTo('이 원서 취소하기');
  await sweep('원서 1단계 (취소 칸 열림)');
  await keyTo('그만두기');
  for (const [no, title] of [[2, '2. 대학·전형'], [3, '3. 추가정보'], [4, '4. 서류']]) {
    await keyTo('다음 단계');
    await b.waitFor(`document.body.innerText.includes(${JSON.stringify(title)})`, title);
    await sweep(`원서 ${no}단계`);
  }
  // 서류 — Enter 로 연 파일 대화상자에 파일을 넘긴다(keyboard-walk 와 같다)
  await b.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = new Promise((res) => b.on('Page.fileChooserOpened', res));
  await keyTo('파일 선택');
  const opened = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!opened) throw new Error('Enter 로 파일 대화상자가 열리지 않았다');
  await b.send('DOM.setFileInputFiles', { files: [samplePdf()], backendNodeId: opened.backendNodeId });
  await b.send('Page.setInterceptFileChooserDialog', { enabled: false });
  await b.waitFor(`document.body.innerText.includes('업로드·검사 완료')`, '서류 검사', 60_000);
  await sweep('원서 4단계 (서류 검사 완료)');
  await keyTo('검토 단계로');
  await b.waitFor(`document.body.innerText.includes('입력을 확인해 주십시오')`, '검증 오류');
  await sweep('원서 검증 오류');

  // 오류 요약 링크로 칸에 가서 채운다 — 공통원서를 쓰지 않은 지원자라 1단계 두 칸·3단계 한 칸
  const fills = { highSchool: '한국고등학교', graduationYear: '2027', selfIntro: '공공 서비스의 장애 대응에 관심이 있어 분산 시스템을 공부하고 있습니다.' };
  for (let i = 0; i < 5; i++) {
    const link = await b.evaluate(`document.querySelector('[role=alert] a')?.textContent?.trim() ?? null`);
    if (!link) break;
    await keyTo(link);
    const code = (await focusInfo(b)).id.replace('field-', '');
    if (!fills[code]) throw new Error(`채울 값을 모르는 칸: ${code}`);
    await typeText(b, fills[code]);
  }
  await keyTo('다음 단계');
  await b.waitFor(`document.body.innerText.includes('4. 서류')`, '4단계');
  await keyTo('검토 단계로');
  await b.waitFor(`document.body.innerText.includes('결제가 확인되면 바로 접수가 완료됩니다')`, '5단계', 30_000);
  await sweep('원서 5단계 검토·결제');
  await keyTo('결제 후에는 원서를 수정하거나 취소할 수 없다는 것을 확인했습니다.', ' ');
  await sweep('원서 5단계 (확인 체크 뒤)');
  await keyTo('전형료 결제하고 접수');
  await b.waitFor(`document.body.innerText.includes('접수가 완료되었습니다')`, '접수 완료', 60_000);
  await sweep('원서 6단계 접수 완료');
  await keyTo('접수증 보기·인쇄');
  await b.waitFor(`location.pathname.startsWith('/receipt/') && document.body.innerText.includes('접수번호')`, '접수증');
  await sweep('접수증');

  await sleep(4000); // 중계기가 중앙에 보낼 시간
  await go(`${WEB}/dashboard`, '접수번호');
  await sweep('내 원서 (접수 뒤)');

  // 장애 안내 — 대학 API 에 닿지 못하는 주소로 원서 화면을 열 수는 없다. 없는 원서로 실패 화면을 본다
  await go(`${WEB}/apply/00000000-0000-4000-8000-000000000000`, '현재 상태 다시 확인');
  await sweep('원서 화면 (불러오기 실패)');
}

/* ── 콘솔 ────────────────────────────────────────────────────────────── */

async function admin() {
  await go(`${ADMIN}/`, '지금 처리할 일');
  await sweep('콘솔 첫 화면 (담당자 없음)');
  // 담당자 지정 — 개발 서버의 입력칸에 키보드로
  await keyTo('담당자 ID', 'Tab');
  await press(b, 'Tab', { shift: true });
  await typeText(b, 'officer2@univ-a');
  await press(b, 'Enter');
  await b.waitFor(`document.body.innerText.includes('담당자 바꾸기')`, '담당자 지정');
  const f = await focusInfo(b);
  if (f.name !== '담당자 바꾸기') problems.push(`콘솔: 담당자 지정 뒤 포커스가 "${f.name || '문서 처음'}" 에 있다`);
  await sweep('콘솔 첫 화면 (담당자 지정)');

  await go(`${ADMIN}/config`, '설정 버전');
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '설정 목록');
  await sweep('설정 승인');
  const hasDraft = await b.evaluate(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === '검토')`);
  if (hasDraft) {
    await keyTo('검토');
    await b.waitFor(`document.body.innerText.includes('무엇이 바뀌는가') && !document.body.innerText.includes('불러오는 중')`, '검토 열기');
    const g = await focusInfo(b);
    if (g.id !== 'version-review-title') problems.push(`설정 승인: 검토를 연 뒤 포커스가 "${g.name || '문서 처음'}" 에 있다`);
    await sweep('설정 초안 검토');
  }
  await go(`${ADMIN}/deadline`, '지금 적용 중인 마감');
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '마감 정책');
  await sweep('마감 · 연장');
  await go(`${ADMIN}/reconciliation`, '지금 대조 실행');
  await keyTo('지금 대조 실행 (최근 48시간)');
  await b.waitFor(`document.body.innerText.includes('최근 48시간 대조')`, '대조 결과', 60_000);
  const h = await focusInfo(b);
  if (!h.name.startsWith('최근 48시간 대조')) problems.push(`대조: 실행 뒤 포커스가 "${h.name || '문서 처음'}" 에 있다`);
  await sweep('대조 · 예외');
  await go(`${ADMIN}/evidence`, '증적 조회');
  await sweep('증적 조회');
  // 접수를 마친 원서 하나 — keyboard-walk 가 완주한 가장 최근 원서를 연다
  const walks = readdirSync(path.resolve('tests/a11y/results'))
    .filter((f) => f.startsWith('keyboard-walk-'))
    .map((f) => JSON.parse(readFileSync(path.resolve('tests/a11y/results', f), 'utf8')))
    .filter((r) => r.completed && r.applicationId)
    .sort((x, y) => x.at.localeCompare(y.at));
  const applicationId = walks.at(-1)?.applicationId ?? null;
  if (!applicationId) console.log('… keyboard-walk 완주 결과가 없어 증적 열람 화면은 건너뛴다');
  if (applicationId) {
    await keyTo('원서 ID', 'Tab');
    await press(b, 'Tab', { shift: true });
    await typeText(b, applicationId);
    await press(b, 'Tab');
    await typeText(b, '접근성 점검 — 증적 화면의 키보드 이동 확인');
    await keyTo('증적 열기');
    await b.waitFor(`document.body.innerText.includes('판정에 쓰인 마감 정책')`, '증적', 30_000);
    const e = await focusInfo(b);
    if (!e.name.startsWith('감사 체인')) problems.push(`증적: 연 뒤 포커스가 "${e.name || '문서 처음'}" 에 있다`);
    await sweep('증적 (열람 결과)');
  }
  await go(`${ADMIN}/retention`, '보존기간');
  await sweep('보존기간');
  await go(`${ADMIN}/no-such-page`, '찾을 수 없는');
  await sweep('콘솔 없는 화면');
}

let fatal = null;
try {
  if (PHASE === 'applicant') await applicant();
  else await admin();
} catch (err) {
  fatal = err.message;
  console.error('✘', err.message);
} finally {
  b.close();
}

const result = {
  test: 'T-M5-41 Visible Focus / Focus Order · T-M5-42 Screen Reader',
  environment: '축소 환경 — 로컬 전용 DB(ui-shots-pg)·개발 서버(next dev)',
  phase: PHASE,
  browser: b.browser,
  viewport: { width: WIDTH, height: HEIGHT },
  at: new Date(started).toISOString(),
  fatal,
  screens: screens.length,
  tabStops: screens.reduce((n, s) => n + s.stops.length, 0),
  problems,
  detail: screens,
};
const dir = path.resolve('tests/a11y/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `focus-sweep-${PHASE}-${BROWSER}-${WIDTH}-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
const ok = !fatal && problems.length === 0;
console.log(`${ok ? '✔' : '✘'} 화면 ${result.screens}개 · Tab 자리 ${result.tabStops}개 · 문제 ${problems.length}건 → ${path.relative(process.cwd(), file)}`);
process.exitCode = ok ? 0 : 1;
