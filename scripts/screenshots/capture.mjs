// 화면 캡처 — 설치 없이 이 PC 의 Chrome 을 헤드리스로 띄워 DevTools 프로토콜(CDP)로 조작한다.
//
// 사용: node scripts/screenshots/capture.mjs <단계> [출력 폴더=docs/screenshots] [--check-copy]
//   --check-copy  찍는 화면마다 보이는 글을 검사한다 — 설계 번호·내부 코드·UUID·ISO 시각·영문 검증 문구 (T-M5-56)
//   단계: applicant | central-down | admission-down | seed-recon | admin | auth
//   순서·서버 준비는 docs/screenshots/README.md 「다시 찍기」.
//   auth  로그인 모드(28~35) — 미리보기 `auth-admission`·`auth-central`·`auth-web`(:3001)·`auth-admin`(:4100)과 로컬 발급자(:18080).
//         관리자 재인증 안내를 찍으려고 로그인 뒤 5분(재인증 창)을 실제로 기다린다 — 약 7분
//
// 전용 DB(ui-shots-pg :5497)와 전용 포트(중앙 3100 · 대학 3101 · 지원자 웹 4001 · 콘솔 4101)만 쓴다.
// kind 시험·로컬 개발 DB(:5432)·ka-central(:3000)과 섞이지 않는다.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workDir } from '../../tests/a11y/helpers/workdir.mjs';

// 단계 사이에 이어 쓰는 상태(원서 ID)·Chrome 프로필·실패 화면은 저장소 안 `.cache/`(git 제외)에 둔다 —
// 시스템 임시 폴더는 이 PC 에서 C 드라이브다. 프로필은 한 개를 다시 쓴다.
const WORK = workDir('shots');
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CHECK_COPY = process.argv.includes('--check-copy');
const PHASE = ARGS[0];
const OUT = path.resolve(ARGS[1] ?? 'docs/screenshots');
const WEB = 'http://localhost:4001';
const ADMIN = 'http://localhost:4101';
const CDP_PORT = 9333;
const W = 1280;
const H = 900;
const STATE_FILE = path.join(WORK, 'state.json');
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const APPLICANT_1 = { applicantId: '44444444-4444-4444-4444-444444444444', subjectToken: 'subj-dev-0001' };
const APPLICANT_2 = { applicantId: '55555555-5555-5555-5555-555555555555', subjectToken: 'subj-dev-0002' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Chrome · CDP ─────────────────────────────────────────────────── */

const chrome = spawn(
  process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(WORK, 'chrome-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--lang=ko-KR',
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let targets = null;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  } catch {
    /* 아직 안 떴다 */
  }
}
const target = targets.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const listeners = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(`${msg.error.message}`)) : res(msg.result);
  } else if (msg.method && listeners.has(msg.method)) {
    void listeners.get(msg.method)(msg.params);
  }
});
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`evaluate 실패: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(expression, what, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      /* 이동 중 */
    }
    await sleep(200);
  }
  throw new Error(`기다림 초과: ${what}`);
}
const hasText = (t) => `!!document.body && document.body.innerText.includes(${JSON.stringify(t)})`;
const waitText = (t, timeout) => waitFor(hasText(t), `"${t}"`, timeout);

async function goto(url, readyText) {
  await send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url.split('?')[0])})`, `로드 ${url}`);
  if (readyText) await waitText(readyText, 60_000);
  await sleep(600);
}

/** 버튼·링크를 글자로 찾아 누른다. */
async function click(text, selector = 'button, a') {
  const r = await evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((e) => e.textContent.trim() === ${JSON.stringify(text)});
    const el = els.find((e) => !e.disabled) ?? els[0];
    if (!el) return 'missing';
    if (el.disabled) return 'disabled';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'ok';
  })()`);
  if (r !== 'ok') throw new Error(`누르기 "${text}": ${r}`);
  await sleep(300);
}

/** 라벨 글자로 입력칸을 찾아 값을 넣는다. React 가 알아듣도록 원래 setter + input 이벤트를 쓴다. */
async function fill(label, value) {
  const r = await evaluate(`(() => {
    const want = ${JSON.stringify(label)};
    const lab = [...document.querySelectorAll('label')]
      .find((l) => l.textContent.replace('필수 입력', '').replace(/[*\\s]+$/, '').trim() === want);
    if (!lab) return 'no label';
    const el = (lab.htmlFor && document.getElementById(lab.htmlFor)) || lab.querySelector('input, textarea, select');
    if (!el) return 'no input';
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return 'ok';
  })()`);
  if (r !== 'ok') throw new Error(`입력 "${label}": ${r}`);
}

/** 원서 1단계의 동의 체크를 모두 한다 — 체크마다 서버에 기록된다(D-81) */
async function consentAll() {
  const n = await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('input[type=checkbox][id^="consent-"]')].filter((b) => !b.checked);
    boxes.forEach((b) => b.click());
    return boxes.length;
  })()`);
  if (n > 0) await sleep(800);
}

async function check(label) {
  const r = await evaluate(`(() => {
    const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === ${JSON.stringify(label)} && l.querySelector('input[type=checkbox]'));
    if (!lab) return 'missing';
    const box = lab.querySelector('input');
    if (!box.checked) box.click();
    return 'ok';
  })()`);
  if (r !== 'ok') throw new Error(`체크 "${label}": ${r}`);
}

async function setFile(filePath) {
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  if (!nodeId) throw new Error('파일 입력칸 없음');
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
}

async function setSession(s) {
  await evaluate(`sessionStorage.setItem('wonseoro.dev.session', ${JSON.stringify(JSON.stringify(s))})`);
}

const shots = [];
async function shot(name, caption) {
  // 개발 서버 표시(Next.js 배지)·포커스 테두리는 화면의 일부가 아니다.
  await evaluate(`(() => {
    document.querySelectorAll('nextjs-portal').forEach((e) => e.remove());
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    window.scrollTo(0, 0);
  })()`);
  await sleep(250);
  const m = await send('Page.getLayoutMetrics');
  const height = Math.max(H, Math.ceil(m.cssContentSize.height));
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: W, height, scale: 1 },
  });
  const file = path.join(OUT, `${name}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(r.data, 'base64'));
  shots.push({ name, caption, height });
  console.log(`✔ ${name} (${W}×${height}) — ${caption}`);
  if (CHECK_COPY) await checkCopy(name);
}

/**
 * 렌더링 문구 검사 (docs/08 「회귀 방지」). 소스 검사(scripts/check-ui-copy.mjs)가 못 보는 것 — 서버가 보낸 문구와
 * 데이터 — 까지 화면에 실제로 보이는 글(innerText, 입력칸 값은 빠진다)로 본다.
 * 지원자 화면은 엄격하게, 콘솔은 담당자가 쓰는 식별자(원서 ID·설정 버전·해시)를 허용한다.
 */
const COPY_RULES = [
  { re: /§|\bD-\d+\b|\bT-M\d|기술설계서/, why: '설계 문서 번호' },
  { re: /\bv1\.[01]\b/, why: '설계 문서 판 번호' },
  { re: /\b[A-Z]{2,}(_[A-Z]+)+\b/, why: '내부 상태 코드' },
  { re: /\d{4}-\d{2}-\d{2}T\d{2}:/, why: 'ISO 시각 원문' },
  { re: /\b(must|should|property|required)\b/i, why: '영문 검증 문구' },
  { re: /[✓✕⚠ℹ⟳○]/, why: '기호 아이콘' },
  { re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, why: 'UUID', applicantOnly: true },
  { re: /\bcfg-|subj-dev|\b2027-early/, why: '내부 버전·개발 값', applicantOnly: true },
];
const copyProblems = [];
async function checkCopy(name) {
  const text = await evaluate(`document.body.innerText`);
  const applicant = !name.startsWith('admin/');
  for (const rule of COPY_RULES) {
    if (rule.applicantOnly && !applicant) continue;
    const m = rule.re.exec(text);
    if (m) copyProblems.push(`${name}  [${rule.why}]  …${text.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ')}…`);
  }
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/** 서류 단계에 올릴 한 쪽짜리 PDF. 서버는 확장자가 아니라 파일 머리(%PDF-)를 본다. */
function samplePdf() {
  const text = 'BT /F1 18 Tf 72 720 Td (School record - sample for screenshots) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.join(WORK, 'school-record.pdf');
  writeFileSync(file, pdf);
  return file;
}

/* ── 지원자 흐름 ─────────────────────────────────────────────────── */

async function applicant() {
  const pdf = samplePdf();

  // 1. 접수 홈 — 본인 확인 입력
  await goto(`${WEB}/`, '원서 작성 시작');
  await fill('지원자 식별자', APPLICANT_1.applicantId);
  await fill('공통원서 가명 토큰', APPLICANT_1.subjectToken);
  await sleep(300);
  await shot('applicant/01-home', '접수 홈 — 모집·전형·모집단위는 대학 카탈로그 API 에서 온다');

  // 2. 공통원서
  await click('공통원서 작성·제공 동의');
  await waitText('기본 정보', 60_000);
  await waitFor(`!!document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '저장' && !b.disabled)`, '공통원서 로드');
  await sleep(500);
  await shot('applicant/02-profile-empty', '공통원서 — 처음 열었을 때');
  await fill('출신 고등학교', '한국고등학교');
  await fill('졸업(예정) 연도', '2027');
  await fill('이메일', 'applicant@example.com');
  await fill('휴대전화', '010-1234-5678');
  await check('위 내용에 동의합니다 (필수)'); // 공통원서 수집·이용 동의 (D-82)
  for (const f of ['출신 고등학교', '졸업(예정) 연도', '이메일']) await check(f);
  await click('저장');
  await waitText('저장했습니다');
  await shot('applicant/03-profile-saved', '공통원서 — 저장·대학별 제공 동의');

  // 3. 원서 작성 시작
  await goto(`${WEB}/`, '원서 작성 시작');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '원서 작성 시작' && !b.disabled)`, '세션 복원');
  await click('원서 작성 시작');
  await waitFor(`location.pathname.startsWith('/apply/')`, '원서 화면 이동', 60_000);
  state.applicationId = await evaluate(`location.pathname.split('/')[2]`);
  saveState();
  await waitText('1. 공통정보', 60_000);
  await waitText('출신 고등학교');
  await consentAll();
  await sleep(800);
  await shot('applicant/04-apply-step1-common', '원서 1단계 공통정보 — 수집·이용 동의, 동의한 공통원서 항목이 복사된다');

  await click('다음 단계');
  await waitText('원서로대학교');
  await shot('applicant/05-apply-step2-program', '원서 2단계 대학·전형 — 전형료·모집단위');

  await click('다음 단계');
  await waitText('3. 추가정보');
  await fill('학적 변동 사항', '없음');
  await fill('내신 성적', '1.8');
  await sleep(16_500); // 자동저장 Debounce 15초
  await waitText('저장 완료', 20_000);
  await shot('applicant/07-apply-step3-extra', '원서 3단계 추가정보 — 전형 양식(JSON Schema)으로 그린 입력칸·자동저장');

  await click('다음 단계');
  await waitText('4. 서류');
  await setFile(pdf);
  await waitFor(`/업로드 완료|업로드·검사 완료/.test(document.body.innerText)`, '업로드', 40_000);
  // 검사 워커가 끝낼 때까지 화면의 "검사 상태 새로고침" 을 누른다.
  for (let i = 0; i < 20 && !(await evaluate(hasText('검사 완료'))); i++) {
    await sleep(1500);
    await click('검사 상태 새로고침');
  }
  await waitText('검사 완료', 5_000);
  await sleep(500);
  await shot('applicant/08-apply-step4-documents', '원서 4단계 서류 — 직접 업로드·악성코드 검사 상태를 글로 표시');

  await click('검토 단계로');
  await waitText('결제가 확인되면 바로 접수가 완료됩니다', 30_000); // 5단계에만 있는 문구 — 단계 표시기에는 늘 '5. 검토·결제' 가 있다
  await sleep(800);
  await shot('applicant/09-apply-step5-review', '원서 5단계 검토·결제 — 결제가 곧 접수라는 경고·결제 전 확인 체크');

  await check('결제 후에는 원서를 수정하거나 취소할 수 없다는 것을 확인했습니다.');
  await click('전형료 결제하고 접수');
  await waitText('접수가 완료되었습니다', 60_000);
  await sleep(1500);
  await shot('applicant/10-apply-complete', '접수 완료 — 접수번호·접수 시각');

  state.submissionHref = await evaluate(`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === '접수증 보기·인쇄')?.getAttribute('href')`);
  saveState();
  await goto(`${WEB}${state.submissionHref}`, '접수번호');
  await sleep(800);
  await shot('applicant/11-receipt', '접수증 — 전형·모집단위·상태, 인쇄 때 메뉴·버튼은 빠진다');

  await sleep(4000); // Relay 가 중앙에 보낼 시간
  await goto(`${WEB}/dashboard`);
  await waitText('접수번호', 30_000);
  await shot('applicant/12-dashboard', '내 원서 — 중앙 요약·마지막 동기화 시각');

  // 4. 취소 — 두 번째 지원자
  await goto(`${WEB}/`, '원서 작성 시작');
  await setSession(APPLICANT_2);
  await goto(`${WEB}/`, '원서 작성 시작');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '원서 작성 시작' && !b.disabled)`, '세션 복원 2');
  await click('원서 작성 시작');
  await waitFor(`location.pathname.startsWith('/apply/')`, '원서 화면 이동 2', 60_000);
  state.cancelledApplicationId = await evaluate(`location.pathname.split('/')[2]`);
  saveState();
  await waitText('1. 공통정보', 60_000);
  await sleep(500);
  for (let i = 0; i < 3; i++) await click('다음 단계');
  await waitText('4. 서류');
  await click('검토 단계로');
  await waitText('입력을 확인해 주십시오', 30_000);
  await sleep(800);
  await shot('applicant/06-apply-validation-errors', '검토 전 검증 — 빠진 항목을 한곳에 모아 보여 준다 (공통원서를 쓰지 않은 지원자)');

  await click('이 원서 취소하기');
  await fill('취소 사유', '지원 전형을 다시 검토하려고 합니다.');
  await sleep(300);
  await shot('applicant/13-apply-cancel-confirm', '원서 취소 — 사유 입력·되돌릴 수 없음 안내');
  await click('취소 확정');
  await waitText('취소된 원서입니다', 30_000);
  await shot('applicant/14-apply-cancelled', '취소된 원서');
}

/* ── 장애 화면 ───────────────────────────────────────────────────── */

async function centralDown() {
  await goto(`${WEB}/`, '원서 작성 시작');
  await setSession({ ...APPLICANT_1, applicationId: state.applicationId });
  await goto(`${WEB}/`, '원서 작성 시작');
  await waitText('통합 조회 서비스와 연결이 원활하지 않습니다', 60_000);
  await sleep(500);
  await shot('failure/15-home-central-down', '중앙 장애 중 접수 홈 — 대학 접수는 계속된다는 운영 배너');

  await goto(`${WEB}/dashboard`);
  await waitText('통합 조회를 일시적으로 사용할 수 없습니다', 30_000);
  await shot('failure/16-dashboard-central-down', '중앙 장애 중 내 원서 — 접수 실패로 보이지 않게 안내');

  await goto(`${WEB}/profile`);
  await waitText('공통원서 서버에 연결할 수 없습니다', 30_000);
  await sleep(500);
  await shot('failure/17-profile-central-down', '중앙 장애 중 공통원서 — 원서는 직접 입력으로 계속');
}

async function admissionDown() {
  await goto(`${WEB}/`);
  await setSession({ ...APPLICANT_1, applicationId: state.applicationId });
  await goto(`${WEB}/apply/${state.applicationId}`);
  await waitText('대학 접수 서버에 연결할 수 없습니다', 60_000);
  await sleep(500);
  await shot('failure/18-apply-university-down', '대학 서버 장애 — 마지막 저장 시각·다시 확인 버튼');

  await goto(`${WEB}/`);
  await waitText('다시 시도', 60_000);
  await shot('failure/19-home-university-down', '대학 서버 장애 중 접수 홈');
}

/* ── 관리자 콘솔 ─────────────────────────────────────────────────── */

async function operator(id) {
  const cur = await evaluate(`document.body.innerText.includes('담당자 바꾸기')`);
  if (cur) {
    await click('담당자 바꾸기');
    await waitText('담당자 ID');
  }
  await evaluate(`(() => {
    const el = document.getElementById('operator-id');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(id)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('지정');
  await waitText(`${id}`);
  await sleep(300);
}

async function admin() {
  await goto(`${ADMIN}/`, '입학처 콘솔');
  await waitText('2027 수시', 60_000);
  await shot('admin/20-console-home', '입학처 콘솔 첫 화면 — 지금 처리할 일(승인 대기·미해결 불일치·지금 마감)');

  await goto(`${ADMIN}/deadline`, '마감 · 연장');
  await waitText('정책 2027-early-v1', 60_000);
  await operator('officer1@univ-a');
  await waitText('마감 연장 초안 만들기', 20_000);
  await fill('입학처 결정 문서번호', '입학처-2026-0412');
  await fill('연장 사유', '접수 서버 장애로 12월 31일 17:10~17:50 제출 불가');
  await evaluate(`(() => {
    const el = document.getElementById('new-deadline');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2026-12-31T20:00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await click('연장 초안 만들기');
  await waitText('연장 초안', 20_000);
  await waitText('승인 1', 20_000);
  await sleep(500);
  await shot('admin/21-deadline-extension-draft', '마감 연장 초안 — 작성자는 승인할 수 없다(버튼 옆에 이유)');

  await operator('officer2@univ-a');
  await click('승인');
  await waitText('승인했습니다', 20_000);
  await sleep(500);
  await shot('admin/22-deadline-one-approval', '마감 연장 — 승인 1명, 적용하려면 1명 더');

  await goto(`${ADMIN}/config`, '설정 승인');
  await waitText('설정 버전', 60_000);
  await waitText('cfg-2027-v2', 20_000);
  await sleep(500);
  await shot('admin/23-config-versions', '설정 승인 — 설정 버전 목록·초안 만들기');
  await click('검토');
  await waitText('무엇이 바뀌는가', 20_000);
  await waitFor(`!document.body.innerText.includes('불러오는 중…')`, 'Diff 로드');
  await sleep(800);
  await shot('admin/24-config-review', '설정 초안 검토 — 현재 설정 대비 변경·되돌리기 어려운 변경 경고·2인 승인');

  await goto(`${ADMIN}/reconciliation`, '대조 · 예외');
  await waitText('지금 대조 실행', 60_000);
  await sleep(800);
  await click('지금 대조 실행 (최근 48시간)');
  await waitText('원서', 30_000);
  await sleep(1500);
  await shot('admin/25-reconciliation', '대조 · 예외 — 중앙 반영 확인이 없는 접수를 찾아 사람에게 넘긴다');

  await goto(`${ADMIN}/evidence`, '증적 조회');
  await fill('원서 ID', state.applicationId);
  await fill('조회 사유', '접수 과정 확인 (화면 캡처용 시연)');
  await sleep(300);
  await click('증적 열기');
  await waitText('판정에 쓰인 마감 정책', 30_000);
  await sleep(800);
  await shot('admin/26-evidence', '증적 조회 — 한 원서의 접수 과정·마감 정책·결제·서류 재구성');

  await goto(`${ADMIN}/retention`, '보존기간');
  await sleep(1500);
  await shot('admin/27-retention', '보존기간 — 데이터 종류별 파기 계획(실행하지 않음)');
}

/** 대조 예외 준비 — 중계기를 멈춘 채 두 번째 지원자가 접수한다. 화면은 찍지 않는다. */
async function seedRecon() {
  await goto(`${WEB}/`, '원서 작성 시작');
  await setSession(APPLICANT_2);
  if (state.reconApplicationId) {
    // 앞선 실행이 원서를 만들고 멈췄다 — 한 전형에 원서는 하나라 새로 만들 수 없다. 이어서 한다.
    await goto(`${WEB}/apply/${state.reconApplicationId}`);
  } else {
    await goto(`${WEB}/`, '원서 작성 시작');
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '원서 작성 시작' && !b.disabled)`, '세션 복원');
    await click('원서 작성 시작');
    await waitFor(`location.pathname.startsWith('/apply/')`, '원서 화면 이동', 60_000);
    state.reconApplicationId = await evaluate(`location.pathname.split('/')[2]`);
    saveState();
  }
  await waitText('1. 공통정보', 60_000);
  await waitText('출신 고등학교');
  await sleep(500);
  await fill('출신 고등학교', '미래고등학교');
  await fill('졸업(예정) 연도', '2027');
  await click('다음 단계');
  await click('다음 단계');
  await waitText('3. 추가정보');
  await fill('학적 변동 사항', '검정고시 합격(2025년 8월)');
  await click('다음 단계');
  await waitText('4. 서류');
  await click('검토 단계로');
  await waitText('결제가 확인되면 바로 접수가 완료됩니다', 30_000); // 5단계에만 있는 문구 — 단계 표시기에는 늘 '5. 검토·결제' 가 있다
  await check('결제 후에는 원서를 수정하거나 취소할 수 없다는 것을 확인했습니다.');
  await click('전형료 결제하고 접수');
  await waitText('접수가 완료되었습니다', 60_000);
  console.log('✔ 두 번째 지원자 접수', state.reconApplicationId);
}

/* ── 로그인 모드 (T-M5-02 단계 9) ────────────────────────────────────── */

async function auth() {
  const WEB_OIDC = 'http://localhost:3001';
  const ADMIN_OIDC = 'http://localhost:4100';
  const { freshTotp } = await import('../../tests/auth/helpers/totp.mjs');
  const realm = (name) => JSON.parse(readFileSync(`infra/auth/${name}.realm.json`, 'utf8'));
  const secretOf = (r, username) => {
    const u = r.users.find((x) => x.username === username);
    const otp = u.credentials.find((c) => c.type === 'otp');
    return { password: u.credentials.find((c) => c.type === 'password').value, otp: otp ? JSON.parse(otp.secretData).value : null };
  };
  const onIssuer = (what) =>
    waitFor(`location.host === 'localhost:18080' && document.documentElement.getAttribute('data-wonseoro-a11y') === 'ready'`, `${what} — 로그인 서버`);
  const signIn = async (username, secret) => {
    await evaluate(`(() => {
      const u = document.querySelector('#username'); if (u) u.value = ${JSON.stringify(username)};
      document.querySelector('#password').value = ${JSON.stringify(secret)};
      document.querySelector('form').submit();
    })()`);
  };
  const otpIn = async (secret) => {
    const code = await freshTotp(secret);
    await evaluate(`(() => { document.querySelector('#otp').value = ${JSON.stringify(code)}; document.querySelector('form').submit(); })()`);
  };
  await send('Network.enable');
  await send('Network.clearBrowserCookies');

  // 지원자 — 본인확인
  const applicantSecret = secretOf(realm('wonseoro-applicant'), 'applicant-2');
  await goto(`${WEB_OIDC}/`, '원서를 작성하려면 본인확인이 필요합니다');
  await evaluate('sessionStorage.clear()');
  await goto(`${WEB_OIDC}/`, '원서를 작성하려면 본인확인이 필요합니다');
  await shot('applicant/28-login-required', '본인확인 전 접수 홈 — 원서 작성 전에 본인확인');
  await click('본인확인');
  await onIssuer('지원자 본인확인');
  await waitFor(`!!document.querySelector('#username')`, '본인확인 화면');
  await sleep(400);
  await shot('login/29-issuer-applicant', '로그인 서버 — 지원자 본인확인(원서로 로그인 테마)');
  await signIn('applicant-2', applicantSecret.password);
  await waitFor(`location.origin === ${JSON.stringify(WEB_OIDC)} && ${hasText('본인확인을 마쳤습니다')}`, '본인확인 뒤 홈', 60_000);
  await sleep(600);
  await shot('applicant/30-signed-in', '본인확인 뒤 접수 홈 — 로그아웃');
  // 위험 차단 — 서버의 실제 응답 모양(429 + 다시 본인확인하면 풀린다)을 원서 시작 요청 하나에만 돌려준다(서버 쪽은 통합 시험이 본다)
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/applications', requestStage: 'Request' }] });
  let limited = false;
  listeners.set('Fetch.requestPaused', async (e) => {
    if (e.request.method === 'POST' && !limited) {
      limited = true;
      await send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 429,
        responseHeaders: [
          { name: 'content-type', value: 'application/problem+json' },
          { name: 'retry-after', value: '600' },
          { name: 'www-authenticate', value: 'Bearer error="insufficient_user_authentication", max_age=0' },
          { name: 'access-control-allow-origin', value: WEB_OIDC },
          { name: 'access-control-expose-headers', value: 'retry-after, etag, www-authenticate' },
        ],
        body: Buffer.from(JSON.stringify({ type: 'about:blank', title: '요청이 많습니다', status: 429, code: 'RATE_LIMITED', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' })).toString('base64'),
      });
    } else {
      await send('Fetch.continueRequest', { requestId: e.requestId });
    }
  });
  await click('원서 작성 시작');
  await waitText('본인확인 다시 하기');
  await send('Fetch.disable');
  listeners.delete('Fetch.requestPaused');
  await sleep(400);
  await shot('applicant/31-ratelimit-reauth', '요청 한도(위험 차단) — 기다리거나 본인확인 다시 하기로 바로 풀기');

  // 관리자 — 로그인·일회용 번호·재인증
  const staff = realm('wonseoro-staff');
  await goto(`${ADMIN_OIDC}/`, '관리자 로그인이 필요합니다');
  await shot('admin/32-console-login-required', '콘솔 로그인 전 — 관리자 로그인');
  await click('관리자 로그인');
  await onIssuer('관리자 로그인');
  await signIn('auditor', secretOf(staff, 'auditor').password);
  await waitFor(`!!document.querySelector('#otp') && document.documentElement.getAttribute('data-wonseoro-a11y') === 'ready'`, '일회용 번호 화면');
  await sleep(400);
  await shot('login/33-issuer-staff-otp', '로그인 서버 — 담당자 일회용 번호(비밀번호 다음)');
  await otpIn(secretOf(staff, 'auditor').otp);
  const loggedInAt = Date.now();
  await waitFor(`location.origin === ${JSON.stringify(ADMIN_OIDC)} && ${hasText('로그아웃')}`, '로그인 뒤 콘솔', 60_000);
  await goto(`${ADMIN_OIDC}/evidence`, '이 조회는 기록됩니다');
  await waitText('로그아웃');
  await shot('admin/34-console-signed-in', '로그인 뒤 콘솔 — 담당자 이름·역할·로그아웃, 증적 조회(감사 담당)');
  // 재인증 창(5분)이 지나기를 기다린다 — 그 뒤 증적 열람은 본인 확인을 한 번 더 요구한다
  const wait = loggedInAt + 5 * 60_000 + 15_000 - Date.now();
  console.log(`· 재인증 창이 지나기를 ${Math.round(wait / 1000)}초 기다린다`);
  await sleep(Math.max(0, wait));
  await goto(`${ADMIN_OIDC}/evidence`, '이 조회는 기록됩니다');
  await fill('원서 ID', '00000000-0000-4000-8000-000000000000');
  await fill('조회 사유', '지원자 문의 — 마감 직전 제출 여부 확인');
  await click('증적 열기');
  await waitText('본인 확인을 한 번 더 해 주십시오', 30_000);
  await sleep(400);
  await shot('admin/35-console-reauth', '민감 동작 재인증 — 5분이 지나 증적 열람 전에 본인 확인을 한 번 더');
}

try {
  if (PHASE === 'applicant') await applicant();
  else if (PHASE === 'auth') await auth();
  else if (PHASE === 'central-down') await centralDown();
  else if (PHASE === 'admission-down') await admissionDown();
  else if (PHASE === 'admin') await admin();
  else if (PHASE === 'seed-recon') await seedRecon();
  else throw new Error(`알 수 없는 단계: ${PHASE}`);
  if (CHECK_COPY) {
    if (copyProblems.length) {
      console.error(`✘ 렌더링 문구 검사 — ${copyProblems.length}건`);
      for (const x of copyProblems) console.error(`  ${x}`);
      process.exitCode = 1;
    } else {
      console.log(`✔ 렌더링 문구 검사 — 화면 ${shots.length}장 이상 없음`);
    }
  }
} catch (err) {
  console.error('✘', err.message);
  const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (r) writeFileSync(path.join(WORK, `fail-${PHASE}.png`), Buffer.from(r.data, 'base64'));
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
