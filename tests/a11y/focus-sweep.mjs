// T-M5-41 Visible Focus / Focus Order — 모든 화면을 Tab 으로 한 바퀴 돈다.
//
// 사용: node tests/a11y/focus-sweep.mjs <applicant|admin|status|admin-oidc|applicant-oidc|issuer> [--width=1280] [--browser=chrome|edge]
//   applicant  지원자 웹(:4001) — 접수 홈·공통원서·내 원서·원서 1~6단계·접수증·없는 화면·장애 안내
//   admin      입학처 콘솔(:4101) — 첫 화면·설정 승인(검토 열기)·마감·대조·증적·보존기간·없는 화면
//   admin-oidc 관리자 로그인 콘솔(:4100, 미리보기 `auth-admin`·`auth-admission`·로컬 발급자) — 로그인 전 화면, 키보드로
//              발급자 로그인(비밀번호·일회용 번호), 로그인 뒤 첫 화면·설정 승인. 발급자 화면 자체는 돌지 않는다(우리 화면이 아니다)
//   applicant-oidc 본인확인 지원자 화면(:3001, 미리보기 `auth-web`·`auth-admission`·`auth-central`) — 본인확인 전 홈, 키보드로 본인확인,
//              본인확인 뒤 홈·공통원서 저장·원서 1단계 자동저장, 위험 차단 안내의 "본인확인 다시 하기"(응답 하나만 429 로 바꾼다) → 재본인확인 → 로그아웃
//   issuer     로그인 서버(로컬 발급자 :18080) 화면 — 지원자 본인확인·관리자 로그인·일회용 번호·로그인 실패 안내. 우리가 만든 화면은 아니지만
//              지원자·담당자가 반드시 지나는 화면이다(T-M5-02 단계 9). 웹 서버 없이 발급자만 있으면 된다
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
/** 글자만 키우기 — 브라우저 설정의 글꼴 크기처럼 문서 기본 글자 크기를 배수로 (T-M5-43, KWCAG 1.4.4) */
const TEXT_ZOOM = Number(arg('text-zoom', '1'));
const WEB = 'http://localhost:4001';
const ADMIN = 'http://localhost:4101';
const API = 'http://localhost:3101';
const ADMIN_OIDC = 'http://localhost:4100';
const WEB_OIDC = 'http://localhost:3001';
const PG = 'ui-shots-pg';
if (!['applicant', 'admin', 'status', 'admin-oidc', 'applicant-oidc', 'issuer'].includes(PHASE ?? '')) {
  console.error('사용: node tests/a11y/focus-sweep.mjs <applicant|admin|status|admin-oidc|applicant-oidc|issuer> [--width=1280] [--browser=chrome|edge]');
  process.exit(2);
}

const b = await launch({ width: WIDTH, height: HEIGHT, executable: BROWSERS[BROWSER] ?? BROWSER, port: 9335 });
if (TEXT_ZOOM !== 1) {
  // 화면은 rem 으로 크기를 잡는다 — 문서 기본 글자 크기를 키우면 글·칸·간격이 함께 커진다
  await b.send('Page.addScriptToEvaluateOnNewDocument', {
    // <html> 속성을 바꾸면 화면 프레임워크가 서버 렌더링과 다르다고 경고한다 — 스타일 요소를 더한다
    source: `document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'html { font-size: ${TEXT_ZOOM * 100}% !important; }'; document.head.append(st); });`,
  });
}
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
/**
 * 재배치(KWCAG 1.4.10) — 문서가 화면보다 넓어 옆으로 밀어야 하는가, 칸 안에서 글이 잘리는가.
 * 표는 예외다: 표 자체가 제 영역 안에서 옆으로 움직이는 것은 허용된다(문서 전체가 밀리지 않으면).
 */
const REFLOW = `(() => {
  const d = document.documentElement;
  const over = d.scrollWidth - d.clientWidth;
  const wide = over > 0
    ? [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > d.clientWidth + 1 && !e.closest('[data-scroll-x]'))
        .filter((e) => ![...e.children].some((c) => c.getBoundingClientRect().right > d.clientWidth + 1))
        .slice(0, 3).map((e) => e.tagName + ' "' + (e.innerText || '').trim().slice(0, 30) + '"')
    : [];
  const clipped = [...document.querySelectorAll('main *, header *')].filter((e) => {
    const cs = getComputedStyle(e);
    if (!/hidden|clip/.test(cs.overflowX) || e.classList.contains('krds-sr-only') || e.closest('.krds-sr-only')) return false;
    return e.scrollWidth > e.clientWidth + 1 && (e.innerText || '').trim().length > 0;
  }).slice(0, 3).map((e) => e.tagName + ' "' + (e.innerText || '').trim().slice(0, 30) + '"');
  // 누르는 대상 크기 — KWCAG 2.2(= WCAG 2.5.8) 24×24px. 문장 속 링크는 예외. 체크·라디오는 감싼 라벨이 대상이다
  const small = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, summary')]
    .filter((e) => !e.closest('.krds-sr-only') && !e.classList.contains('krds-skip') && !e.closest('nextjs-portal'))
    .map((e) => { const t = e.closest('label') || e; const r = t.getBoundingClientRect(); const cs = getComputedStyle(e); return { e, w: r.width, h: r.height, inline: cs.display === 'inline' }; })
    .filter((x) => x.w > 0 && x.h > 0 && !x.inline && (x.w < 23.5 || x.h < 23.5)) // 소수점 측정 오차는 넘긴다
    .slice(0, 5).map((x) => x.e.tagName + ' "' + (x.e.innerText || x.e.getAttribute('aria-label') || '').trim().slice(0, 30) + '" ' + Math.round(x.w) + '×' + Math.round(x.h));
  return { over: Math.max(0, over), wide, clipped, small };
})()`;

const MISSED = `(() => {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[aria-hidden=true]') && !(e.closest('details:not([open])') && e.tagName !== 'SUMMARY'); };
  // 같은 이름의 라디오 묶음은 Tab 자리 하나다 — 묶음 안은 화살표로 옮긴다(브라우저 기본·WAI-ARIA 라디오 그룹). 묶음 중 하나에 닿았으면 된다
  const radioReached = (e) => e.type === 'radio' && e.name && [...document.getElementsByName(e.name)].some((r) => r.dataset.sweep !== undefined);
  const missed = [...document.querySelectorAll(sel)].filter((e) => shown(e) && e.dataset.sweep === undefined && !radioReached(e) && !e.closest('nextjs-portal'))
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
  const reflow = await b.evaluate(REFLOW);
  if (reflow.over > 0) bad(`가로 스크롤 ${reflow.over}px — ${reflow.wide.join(' | ')}`);
  for (const x of reflow.clipped) bad(`글이 잘린다 — ${x}`);
  for (const x of reflow.small) bad(`누르는 대상이 24px 보다 작다 — ${x}`);
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
    body: JSON.stringify({ cycleId: cycle.id, admissionTypeId: types[0].id, departmentId: depts[0].id, consents: ['APPLICATION_COLLECTION', 'SCHOOL_RECORD_PROVISION'] }),
  });
  if (!r.ok) throw new Error(`원서 만들기 ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

async function applicant() {
  // 대학별 장애 배너·Status Page — 접근성 순회 뒤 바로 해제한다. 시험이 중간에 멈추면 다음 실행의
  // 관리자 화면에서 해제할 수 있고, 고유 멱등 키라 중복 발행은 없다.
  const incidentResponse = await fetch(`${API}/admin/v1/incidents`, {
    method: 'POST',
    headers: {
      'x-admin-id': 'a11y-sweep@univ-a',
      'content-type': 'application/json',
      'idempotency-key': `a11y-incident-${randomUUID()}`,
    },
    body: JSON.stringify({
      severity: 'NOTICE',
      title: '서비스 상태 안내',
      message: '접수 기능은 정상입니다. 서비스 상태 화면의 키보드 이동을 확인하고 있습니다.',
    }),
  });
  if (!incidentResponse.ok) throw new Error(`장애 공지 만들기 ${incidentResponse.status} ${await incidentResponse.text()}`);
  const incident = await incidentResponse.json();

  await go(`${WEB}/`, '원서 작성 시작');
  await sweep('접수 홈 (본인확인 전)');
  await go(`${WEB}/status`, '서비스 상태 안내');
  await sweep('서비스 상태 (대학별 공지)');
  const resolved = await fetch(`${API}/admin/v1/incidents/${incident.id}/resolve`, {
    method: 'POST',
    headers: { 'x-admin-id': 'a11y-sweep@univ-a', 'idempotency-key': `a11y-resolve-${randomUUID()}` },
  });
  if (!resolved.ok) throw new Error(`장애 공지 해제 ${resolved.status} ${await resolved.text()}`);
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
  // 공통원서 수집·이용 동의 → 저장 → 삭제 확인 칸 → 삭제 (D-82). 이 지원자는 공통원서 없이 원서를 쓴다
  await keyTo('위 내용에 동의합니다 (필수)', ' ');
  await keyTo('저장');
  await b.waitFor(`document.body.innerText.includes('저장했습니다')`, '공통원서 저장');
  await keyTo('공통원서 삭제하기');
  const del = await focusInfo(b);
  if (del.id !== 'profile-delete-confirm') problems.push(`공통원서 삭제: 확인 칸을 연 뒤 포커스가 "${del.name || '문서 처음'}" 에 있다`);
  await sweep('공통원서 (삭제 확인)');
  await keyTo('삭제 확정'); // 순회가 포커스를 옮겼다 — 확정 버튼으로 다시 가서 Enter
  await b.waitFor(`document.body.innerText.includes('공통원서를 지웠습니다')`, '공통원서 삭제');
  const gone = await focusInfo(b);
  if (!gone.name.startsWith('공통원서를 지웠습니다')) problems.push(`공통원서 삭제: 지운 뒤 포커스가 "${gone.name || '문서 처음'}" 에 있다`);
  await sweep('공통원서 (삭제 뒤)');

  // 개인정보 권리 요청 (G-10, D-84) — 종류 없이 보내 오류 → 첫 종류로 포커스 → Space 로 고르고 보낸다
  await go(`${WEB}/privacy/${applicationId}`, '아직 보낸 요청이 없습니다');
  await sweep('개인정보 권리 요청');
  await keyTo('요청 보내기');
  await b.waitFor(`document.body.innerText.includes('요청 종류를 골라 주십시오')`, '권리 요청 오류');
  const pk = await focusInfo(b);
  if (pk.id !== 'kind-ACCESS') problems.push(`권리 요청: 오류 뒤 포커스가 "${pk.name || '문서 처음'}" 에 있다`);
  await sweep('개인정보 권리 요청 (오류)');
  await b.evaluate(`document.getElementById('kind-ACCESS').focus()`);
  await press(b, ' ');
  await keyTo('요청 보내기');
  await b.waitFor(`document.body.innerText.includes('열람 요청을 보냈습니다') && document.body.innerText.includes('처리 기한')`, '권리 요청 보냄');
  const pr = await focusInfo(b);
  if (!pr.name.startsWith('열람 요청을 보냈습니다')) problems.push(`권리 요청: 보낸 뒤 포커스가 "${pr.name || '문서 처음'}" 에 있다`);
  await sweep('개인정보 권리 요청 (보낸 뒤)');

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
  const fills = { highSchool: '한국고등학교', graduationYear: '2027', academicNote: '없음' };
  for (let i = 0; i < 8; i++) {
    const link = await b.evaluate(`document.querySelector('[role=alert] a')?.textContent?.trim() ?? null`);
    if (!link) break;
    await keyTo(link);
    const focusedId = (await focusInfo(b)).id;
    // 동의 오류는 그 체크로 데려간다 — Space 로 동의한다 (D-81)
    if (focusedId.startsWith('consent-')) {
      await press(b, ' ');
      await sleep(500);
      continue;
    }
    const code = focusedId.replace('field-', '');
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

/** T-M6-06 빠른 회귀 — 전체 원서 흐름 없이 대학별 배너·Status Page 만 1280/320으로 돈다. */
async function serviceStatus() {
  const created = await fetch(`${API}/admin/v1/incidents`, {
    method: 'POST',
    headers: {
      'x-admin-id': 'a11y-status@univ-a',
      'content-type': 'application/json',
      'idempotency-key': `a11y-status-${randomUUID()}`,
    },
    body: JSON.stringify({
      severity: 'DEGRADED',
      title: '서류 확인이 지연되고 있습니다',
      message: '원서는 계속 작성할 수 있습니다. 올린 서류의 확인 결과가 늦게 표시될 수 있습니다.',
    }),
  });
  if (!created.ok) throw new Error(`장애 공지 만들기 ${created.status} ${await created.text()}`);
  const incident = await created.json();
  try {
    await go(`${WEB}/`, '서류 확인이 지연되고 있습니다');
    await sweep('접수 홈 (대학별 장애 배너)');
    await go(`${WEB}/status`, '서류 확인이 지연되고 있습니다');
    await sweep('서비스 상태 (대학별 장애 공지)');
  } finally {
    await fetch(`${API}/admin/v1/incidents/${incident.id}/resolve`, {
      method: 'POST',
      headers: { 'x-admin-id': 'a11y-status@univ-a', 'idempotency-key': `a11y-status-resolve-${randomUUID()}` },
    });
  }
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
  await keyTo('지금 적용 중인 설정에서 시작');
  await b.waitFor(`document.body.innerText.includes('문항과 제출 서류 구성')`, '전형 Schema 온보딩');
  await sweep('전형 Schema 온보딩');
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
  await go(`${ADMIN}/status`, '지원자 공지 발행');
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '장애 공지 원장');
  await sweep('장애 공지');
  await go(`${ADMIN}/evidence`, '증적 조회');
  await sweep('증적 조회');
  // 접수를 마친 원서 하나 — keyboard-walk 가 완주한 가장 최근 원서를 연다
  const walks = readdirSync(path.resolve('tests/a11y/results'))
    .filter((f) => f.startsWith('keyboard-walk-'))
    .map((f) => JSON.parse(readFileSync(path.resolve('tests/a11y/results', f), 'utf8')))
    .filter((r) => r.completed && r.applicationId)
    .sort((x, y) => x.at.localeCompare(y.at));
  const candidateId = walks.at(-1)?.applicationId ?? null;
  // 결과 파일은 DB보다 오래 남는다. DB를 새로 만든 뒤의 옛 원서 ID를 넣으면 실패 화면을 기다리다
  // 시험 자체가 멈춘다. 지금 전용 DB에 실제로 있는 원서만 열람한다.
  const candidate = candidateId
    ? await fetch(`${API}/admin/v1/evidence/applications/${candidateId}`, {
        headers: { 'x-admin-id': 'officer2@univ-a', 'x-evidence-reason': '접근성 점검 사전 확인' },
      }).catch(() => null)
    : null;
  const applicationId = candidate?.ok ? candidateId : null;
  if (!applicationId) console.log('… keyboard-walk 완주 결과가 없어 증적 열람 화면은 건너뛴다');
  if (applicationId) {
    await keyTo('접수번호 또는 원서 ID', 'Tab');
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
  // 상담 조회 (T-M6-07) — 새 원서의 상담 확인번호를 지원자 상태 확인에서 받아 키보드로 조회하고, 증적번호로 다시 연다
  const sa = newApplicant();
  const supportApp = await createApplication(sa);
  const check = await (await fetch(`${API}/api/v1/applications/${supportApp}/self-check`, {
    headers: { 'x-applicant-id': sa.applicantId, 'x-subject-token': sa.subjectToken },
  })).json();
  if (!/^[0-9A-Z]{10}$/.test(check.supportCode ?? '')) throw new Error(`상담 확인번호 없음: ${JSON.stringify(check).slice(0, 200)}`);
  await go(`${ADMIN}/support`, '원서 찾기');
  await sweep('상담 조회');
  await keyTo('접수번호 또는 상담 확인번호', 'Tab');
  await press(b, 'Tab', { shift: true });
  await typeText(b, `${check.supportCode.slice(0, 5)}-${check.supportCode.slice(5)}`);
  await press(b, 'Tab');
  await press(b, 'ArrowDown');
  await keyTo('조회');
  await b.waitFor(`document.body.innerText.includes('안내할 말')`, '상담 조회 결과', 30_000);
  const s1 = await focusInfo(b);
  if (!s1.name.startsWith('증적번호')) problems.push(`상담 조회: 조회 뒤 포커스가 "${s1.name || '문서 처음'}" 에 있다`);
  await sweep('상담 조회 (결과)');
  const evidenceNumber = await b.evaluate(`(document.body.innerText.match(/SR-\\d{8}-[0-9A-Z]{6}/) || [''])[0]`);
  if (!evidenceNumber) throw new Error('증적번호를 화면에서 찾지 못했다');
  await go(`${ADMIN}/support`, '증적번호로 다시 보기');
  await keyTo('증적번호', 'Tab');
  await press(b, 'Tab', { shift: true });
  await typeText(b, evidenceNumber);
  await keyTo('다시 보기');
  await b.waitFor(`document.body.innerText.includes('기록 원본과 같습니다')`, '증적번호로 다시 보기 결과', 30_000);
  const s2 = await focusInfo(b);
  if (!s2.name.startsWith('증적번호')) problems.push(`상담 다시 보기: 연 뒤 포커스가 "${s2.name || '문서 처음'}" 에 있다`);
  await sweep('상담 조회 (증적번호로 다시 보기)');

  // 권리 요청 처리 큐 (G-10, D-84) — 지원자 요청을 API 로 하나 만들고, 키보드로 열어 회신한다
  const pa = newApplicant();
  const privacyApp = await createApplication(pa);
  const pr = await fetch(`${API}/api/v1/applications/${privacyApp}/privacy-requests`, {
    method: 'POST',
    headers: {
      'x-applicant-id': pa.applicantId,
      'x-subject-token': pa.subjectToken,
      'content-type': 'application/json',
      'idempotency-key': `a11y-privacy-${randomUUID()}`,
    },
    body: JSON.stringify({ kind: 'CORRECTION', detail: '출신 고등학교 이름을 바로잡아 주십시오.' }),
  });
  if (!pr.ok) throw new Error(`권리 요청 만들기 ${pr.status} ${await pr.text()}`);
  const requestNumber = (await pr.json()).requestNumber;
  await go(`${ADMIN}/privacy`, requestNumber);
  await sweep('권리 요청 처리 큐');
  await keyTo(`${requestNumber} 열기`);
  await b.waitFor(`document.body.innerText.includes('이 열람은 기록됩니다')`, '권리 요청 열람', 30_000);
  const p1 = await focusInfo(b);
  if (p1.id !== 'privacy-detail-title') problems.push(`권리 요청: 연 뒤 포커스가 "${p1.name || '문서 처음'}" 에 있다`);
  await sweep('권리 요청 (열람)');
  await keyTo('처리 결과', 'ArrowDown');
  await press(b, 'Tab');
  await typeText(b, '출신 고등학교 이름을 바로잡았습니다.');
  await keyTo('회신');
  await b.waitFor(`document.body.innerText.includes('회신했습니다')`, '권리 요청 회신', 30_000);
  const p2 = await focusInfo(b);
  if (!p2.name.includes('회신했습니다')) problems.push(`권리 요청: 회신 뒤 포커스가 "${p2.name || '문서 처음'}" 에 있다`);
  await sweep('권리 요청 (회신 뒤)');

  await go(`${ADMIN}/retention`, '보존기간');
  await sweep('보존기간');
  await go(`${ADMIN}/no-such-page`, '찾을 수 없는');
  await sweep('콘솔 없는 화면');
}

/* ── 관리자 로그인 콘솔 (T-M5-10) ────────────────────────────────────── */

async function adminOidc() {
  const { freshTotp } = await import('../auth/helpers/totp.mjs');
  const realm = JSON.parse(readFileSync(path.resolve('infra/auth/wonseoro-staff.realm.json'), 'utf8'));
  const u = realm.users.find((x) => x.username === 'admin-a');
  const password = u.credentials.find((c) => c.type === 'password').value;
  const otpSecret = JSON.parse(u.credentials.find((c) => c.type === 'otp').secretData).value;

  await go(`${ADMIN_OIDC}/`, '관리자 로그인이 필요합니다');
  await sweep('콘솔 로그인 전 (관리자 로그인)');
  // 키보드로 로그인 — 발급자 화면은 첫 칸(사용자 이름)에 포커스를 둔다
  await keyTo('관리자 로그인');
  await b.waitFor(`location.host === 'localhost:18080' && !!document.querySelector('#username')`, '발급자 로그인 화면');
  await b.evaluate(`document.querySelector('#username').focus()`);
  await typeText(b, 'admin-a');
  await press(b, 'Tab');
  await typeText(b, password);
  await press(b, 'Enter');
  await b.waitFor(`!!document.querySelector('#otp')`, '일회용 번호 화면');
  await b.evaluate(`document.querySelector('#otp').focus()`);
  await typeText(b, await freshTotp(otpSecret));
  await press(b, 'Enter');
  await b.waitFor(`location.origin === ${JSON.stringify(ADMIN_OIDC)} && document.body.innerText.includes('로그아웃')`, '로그인 뒤 콘솔', 60_000);
  await b.waitFor(`document.body.innerText.includes('지금 처리할 일')`, '첫 화면');
  await sweep('콘솔 첫 화면 (관리자 로그인)');
  await go(`${ADMIN_OIDC}/config`, '설정 버전');
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '설정 목록');
  await sweep('설정 승인 (관리자 로그인)');
  await keyTo('지금 적용 중인 설정에서 시작');
  await b.waitFor(`document.body.innerText.includes('문항과 제출 서류 구성')`, '전형 Schema 온보딩');
  await sweep('전형 Schema 온보딩 (관리자 로그인)');
  await go(`${ADMIN_OIDC}/status`, '지원자 공지 발행');
  await b.waitFor(`!document.body.innerText.includes('불러오는 중')`, '장애 공지 원장');
  await sweep('장애 공지 (관리자 로그인)');
}

/* ── 본인확인 지원자 화면 (T-M5-02 단계 6) ─────────────────────────────── */

async function applicantOidc() {
  const realm = JSON.parse(readFileSync(path.resolve('infra/auth/wonseoro-applicant.realm.json'), 'utf8'));
  const u = realm.users.find((x) => x.username === 'applicant-2');
  const password = u.credentials.find((c) => c.type === 'password').value;
  const signIn = async (username) => {
    await b.waitFor(`location.host === 'localhost:18080' && !!document.querySelector('#password')`, '발급자 본인확인 화면');
    const filled = await b.evaluate(`!!document.querySelector('#username') && document.querySelector('#username').type !== 'hidden'`);
    if (filled) {
      await b.evaluate(`document.querySelector('#username').focus()`);
      await typeText(b, username);
      await press(b, 'Tab');
    } else {
      await b.evaluate(`document.querySelector('#password').focus()`); // 다시 본인확인 — 이름은 발급자가 채워 둔다
    }
    await typeText(b, password);
    await press(b, 'Enter');
  };

  await go(`${WEB_OIDC}/`, '원서를 작성하려면 본인확인이 필요합니다');
  await sweep('접수 홈 (본인확인 전, 본인확인 모드)');
  await keyTo('본인확인');
  await signIn('applicant-2');
  await b.waitFor(`location.origin === ${JSON.stringify(WEB_OIDC)} && document.body.innerText.includes('본인확인을 마쳤습니다')`, '본인확인 뒤 홈', 60_000);
  await sweep('접수 홈 (본인확인 뒤, 본인확인 모드)');

  await go(`${WEB_OIDC}/profile`, '기본 정보');
  await sweep('공통원서 (본인확인 모드)');
  await keyTo('저장');
  await b.waitFor(`document.body.innerText.includes('입력을 확인해 주십시오') || document.body.innerText.includes('저장했습니다')`, '공통원서 저장 결과');

  await go(`${WEB_OIDC}/`, '본인확인을 마쳤습니다');
  await keyTo('원서 작성 시작');
  await b.waitFor(`location.pathname.startsWith('/apply/') && document.body.innerText.includes('1. 공통정보')`, '원서 1단계', 60_000);
  await sweep('원서 1단계 (본인확인 모드)');

  // 위험점수 차단 — 검증 응답 한 번만 429 + "다시 본인확인하면 풀린다" 로 바꾼다(서버 쪽 해제는 admission-api 통합 시험이 본다)
  let limited = false;
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/validate*', requestStage: 'Request' }] });
  b.on('Fetch.requestPaused', async (e) => {
    if (e.request.method === 'POST' && !limited) {
      limited = true;
      await b.send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 429,
        responseHeaders: [
          { name: 'content-type', value: 'application/problem+json' },
          { name: 'retry-after', value: '120' },
          { name: 'www-authenticate', value: 'Bearer error="insufficient_user_authentication", max_age=0' },
          { name: 'access-control-allow-origin', value: WEB_OIDC },
          { name: 'access-control-expose-headers', value: 'retry-after, etag, www-authenticate' },
        ],
        body: Buffer.from(JSON.stringify({ type: 'about:blank', title: '요청이 많습니다', status: 429, code: 'RATE_LIMITED', traceId: 'reauth-proof' })).toString('base64'),
      });
    } else {
      await b.send('Fetch.continueRequest', { requestId: e.requestId });
    }
  });
  for (const title of ['2. 대학·전형', '3. 추가정보', '4. 서류']) {
    await keyTo('다음 단계');
    await b.waitFor(`document.body.innerText.includes(${JSON.stringify(title)})`, title);
  }
  await keyTo('검토 단계로');
  await b.waitFor(`document.body.innerText.includes('요청이 많아 잠시 멈췄습니다') && !!document.getElementById('ratelimit-reauth')`, '위험 차단 안내');
  await sweep('위험 차단 안내 (본인확인 다시 하기)');
  await b.send('Fetch.disable');
  await keyTo('본인확인 다시 하기');
  await b.waitFor(`location.host === 'localhost:18080'`, '다시 본인확인 화면');
  const maxAge = await b.evaluate(`new URL(location.href).searchParams.get('max_age')`);
  if (maxAge !== '0') problems.push(`본인확인 다시 하기: 발급자 요청에 max_age=0 이 없다 (${maxAge})`);
  await signIn('applicant-2');
  await b.waitFor(`location.origin === ${JSON.stringify(WEB_OIDC)} && location.pathname.startsWith('/apply/')`, '원서로 돌아옴', 60_000);
  await b.waitFor(`document.body.innerText.includes('원서 작성')`, '원서 화면');

  // 로그아웃 — 발급자 로그인도 끝내고 홈으로
  await go(`${WEB_OIDC}/`, '본인확인을 마쳤습니다');
  await keyTo('로그아웃');
  await b.waitFor(`location.origin === ${JSON.stringify(WEB_OIDC)} && document.body.innerText.includes('원서를 작성하려면 본인확인이 필요합니다')`, '로그아웃 뒤 홈', 60_000);
  const left = await b.evaluate(`sessionStorage.getItem('wonseoro.auth.tokens')`);
  if (left) problems.push('로그아웃 뒤에도 이 탭에 토큰이 남아 있다');
  await sweep('접수 홈 (로그아웃 뒤)');
}

/* ── 로그인 서버 화면 (T-M5-02 단계 9) ─────────────────────────────────── */

async function issuer() {
  const { createHash, randomBytes } = await import('node:crypto');
  const ISSUER = 'http://localhost:18080';
  const authUrl = (realm, clientId, redirect) => {
    const u = new URL(`${ISSUER}/realms/${realm}/protocol/openid-connect/auth`);
    const verifier = randomBytes(32).toString('base64url');
    for (const [k, v] of Object.entries({
      client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid', state: randomBytes(8).toString('hex'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ui_locales: 'ko',
    })) u.searchParams.set(k, v);
    return u.href;
  };
  const staff = JSON.parse(readFileSync(path.resolve('infra/auth/wonseoro-staff.realm.json'), 'utf8')).users.find((x) => x.username === 'admin-a');
  const password = staff.credentials.find((c) => c.type === 'password').value;
  const submit = async (fields) => {
    for (const [sel, value] of fields) {
      await b.evaluate(`document.querySelector(${JSON.stringify(sel)}).focus()`);
      await typeText(b, value);
    }
    await press(b, 'Enter');
  };
  // 원서로 로그인 테마의 접근성 보완이 적용된 화면인가 — 아니면 기본 테마 화면을 재고 있는 것이다
  const themed = (what) => b.waitFor(`document.documentElement.getAttribute('data-wonseoro-a11y') === 'ready'`, `${what} — 원서로 로그인 테마`, 15_000);

  await b.send('Network.clearBrowserCookies').catch(() => {});
  await go(authUrl('wonseoro-applicant', 'applicant-web', 'http://localhost:3001/auth/callback'));
  await b.waitFor(`!!document.querySelector('#username')`, '지원자 본인확인 화면');
  await themed('지원자 본인확인');
  await sweep('로그인 서버 — 지원자 본인확인');
  // 없는 사용자로 실패 — 잠금 정책(사용자별 실패 횟수)을 건드리지 않는다
  await submit([['#username', `nobody-${Date.now()}`], ['#password', 'wrong-password']]);
  await b.waitFor(`!!document.querySelector('#input-error') || document.body.innerText.includes('잘못')`, '로그인 실패 안내');
  await themed('로그인 실패 안내');
  await sweep('로그인 서버 — 지원자 본인확인 실패 안내');

  await go(authUrl('wonseoro-staff', 'admin-web', 'http://localhost:4100/auth/callback'));
  await b.waitFor(`!!document.querySelector('#username')`, '관리자 로그인 화면');
  await themed('관리자 로그인');
  await sweep('로그인 서버 — 관리자 로그인');
  await submit([['#username', 'admin-a'], ['#password', password]]);
  await b.waitFor(`!!document.querySelector('#otp')`, '일회용 번호 화면');
  await themed('일회용 번호');
  await sweep('로그인 서버 — 관리자 일회용 번호');
  // 일회용 번호는 넣지 않는다 — 다른 시험과 같은 30초 창의 번호를 겹쳐 쓰면 발급자가 재사용으로 거절하고 실패로 센다(잠금 정책)
}

let fatal = null;
try {
  if (PHASE === 'applicant') await applicant();
  else if (PHASE === 'issuer') await issuer();
  else if (PHASE === 'applicant-oidc') await applicantOidc();
  else if (PHASE === 'admin-oidc') await adminOidc();
  else if (PHASE === 'status') await serviceStatus();
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
  textZoom: TEXT_ZOOM,
  at: new Date(started).toISOString(),
  fatal,
  screens: screens.length,
  tabStops: screens.reduce((n, s) => n + s.stops.length, 0),
  problems,
  detail: screens,
};
const dir = path.resolve('tests/a11y/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `focus-sweep-${PHASE}-${BROWSER}-${WIDTH}${TEXT_ZOOM !== 1 ? `-text${TEXT_ZOOM * 100}` : ''}-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
const ok = !fatal && problems.length === 0;
console.log(`${ok ? '✔' : '✘'} 화면 ${result.screens}개 · Tab 자리 ${result.tabStops}개 · 문제 ${problems.length}건 → ${path.relative(process.cwd(), file)}`);
process.exitCode = ok ? 0 : 1;
