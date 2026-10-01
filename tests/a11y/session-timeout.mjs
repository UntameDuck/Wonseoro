// T-M5-45 세션 만료 사전 경고 — 입력을 잃기 전에 알리고, 한 번에 연장하고, 끝나도 입력이 남는다.
//
// 사용: node tests/a11y/session-timeout.mjs
// 30분을 기다리지 않으려고 **세션의 만료 시각만** 앞당긴다(브라우저 저장소). 나머지는 실제 화면·서버 동작이다.
//   1. 원서 1단계에서 키보드로 입력(자동저장 15초 전) → 만료 5분 전 경고가 뜬다
//      — 대화상자가 포커스를 받고, 제목·끝나는 시각을 스크린리더 재료로 갖고, 경고 순간 입력이 저장된다
//   2. Tab 이 대화상자 밖으로 나가지 않는다. Esc 는 연장이다 — 닫히고 입력하던 칸으로 포커스가 돌아온다
//   3. 다시 경고 → "계속 이용하기"(Enter) 로 연장
//   4. 더 입력하고 만료 → 마지막 입력이 저장되고, 닫을 수 없는 종료 안내·다시 본인확인 링크, 세션이 지워진다
// 서버는 keyboard-walk 와 같다. 결과는 tests/a11y/results/session-timeout-<시각>.json
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { focusInfo, launch, press, sleep, typeText } from './helpers/browser.mjs';
import { axFocused } from './helpers/ax.mjs';

const WEB = 'http://localhost:4001';
const API = 'http://localhost:3101';
const KEY = 'wonseoro.dev.session';
const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

// 준비 — 새 지원자와 원서(API). 시험하는 것은 화면의 세션 경고다
const a = { applicantId: randomUUID(), subjectToken: `subj-session-${Date.now()}` };
execFileSync('docker', [
  'exec', 'ui-shots-pg', 'psql', '-q', '-U', 'wonseoro', '-d', 'univ_a', '-v', 'ON_ERROR_STOP=1', '-c',
  `INSERT INTO kadmission.applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${a.applicantId}', '${a.subjectToken}', '\\x00', 'v1')`,
]);
const h = { 'x-applicant-id': a.applicantId, 'x-subject-token': a.subjectToken };
const cycle = await (await fetch(`${API}/api/v1/admission-cycles/current`, { headers: h })).json();
const types = await (await fetch(`${API}/api/v1/admission-types?cycleId=${cycle.id}`, { headers: h })).json();
const depts = await (await fetch(`${API}/api/v1/departments?cycleId=${cycle.id}`, { headers: h })).json();
const created = await fetch(`${API}/api/v1/applications`, {
  method: 'POST',
  headers: { ...h, 'content-type': 'application/json', 'idempotency-key': `session-${randomUUID()}` },
  body: JSON.stringify({ cycleId: cycle.id, admissionTypeId: types[0].id, departmentId: depts[0].id }),
});
const applicationId = (await created.json()).id;
const serverValue = async () => (await (await fetch(`${API}/api/v1/applications/${applicationId}`, { headers: h })).json()).fields?.highSchool ?? null;

const b = await launch({ width: 1280, height: 900, port: 9339 });
/** 세션 만료 시각을 지금부터 ms 뒤로 — 시험 준비(30분을 기다리지 않는다) */
const expireIn = (ms) =>
  b.evaluate(`(() => { const s = JSON.parse(sessionStorage.getItem('${KEY}')); s.expiresAt = new Date(Date.now() + ${ms}).toISOString(); sessionStorage.setItem('${KEY}', JSON.stringify(s)); })()`);
const dialog = () =>
  b.evaluate(`(() => { const d = document.querySelector('dialog'); return d ? { open: d.open, text: d.innerText, inside: d.contains(document.activeElement), active: document.activeElement?.id || document.activeElement?.tagName } : null; })()`);

try {
  await b.send('Page.navigate', { url: `${WEB}/` });
  await b.waitFor(`document.readyState === 'complete'`, '홈');
  await b.evaluate(`sessionStorage.setItem('${KEY}', ${JSON.stringify(JSON.stringify({ ...a, applicationId }))})`);
  await b.send('Page.navigate', { url: `${WEB}/apply/${applicationId}` });
  await b.waitFor(`document.body.innerText.includes('출신 고등학교')`, '1단계', 60_000);
  await sleep(800);

  // 1. 입력 → 경고
  for (let i = 0; i < 30 && (await focusInfo(b)).name !== '출신 고등학교'; i++) await press(b, 'Tab');
  await typeText(b, '한국고');
  await expireIn(5 * 60_000 + 2_000);
  await b.waitFor(`document.querySelector('dialog')?.open === true`, '경고 대화상자', 10_000);
  await sleep(300);
  let d = await dialog();
  check(d.text.includes('곧 자동으로 종료됩니다') && d.active === 'session-extend', '만료 5분 전 경고가 뜨고 "계속 이용하기" 가 포커스를 받는다');
  const say = await b.evaluate(`(() => { const d = document.querySelector('dialog'); return { label: document.getElementById(d.getAttribute('aria-labelledby'))?.innerText, desc: document.getElementById(d.getAttribute('aria-describedby'))?.innerText }; })()`);
  check(/곧 자동으로 종료/.test(say.label ?? '') && /\d{2}:\d{2}에 자동으로/.test(say.desc ?? ''), `스크린리더가 제목과 끝나는 시각을 읽는다 — "${say.label}" / "${(say.desc ?? '').slice(0, 40)}…"`);
  const live = await b.evaluate(`[...document.querySelectorAll('dialog [aria-live], dialog [role=status], dialog [role=alert]')].length`);
  check(live === 0, '대화상자 안의 남은 시간(매초 바뀜)은 알림 영역이 아니다');
  await sleep(1500);
  check((await serverValue()) === '한국고', '경고 순간 입력이 저장된다(자동저장 15초를 기다리지 않는다)');

  // 2. 포커스 가둠 · Esc = 연장
  let escaped = false;
  for (let i = 0; i < 6; i++) {
    await press(b, 'Tab');
    const x = await dialog();
    if (!x.inside && x.active !== 'BODY') escaped = true;
  }
  check(!escaped, 'Tab 이 대화상자 밖(뒤 화면)으로 나가지 않는다');
  await b.evaluate(`document.getElementById('session-extend').focus()`);
  await press(b, 'Escape');
  await sleep(1200);
  d = await dialog();
  const back = await focusInfo(b);
  const left = await b.evaluate(`Date.parse(JSON.parse(sessionStorage.getItem('${KEY}')).expiresAt) - Date.now()`);
  check(!d.open && back.name === '출신 고등학교' && left > 29 * 60_000, `Esc 로 연장 — 대화상자가 닫히고 입력하던 칸으로 돌아온다(남은 ${Math.round(left / 60_000)}분)`);

  // 3. 다시 경고 → 계속 이용하기
  await expireIn(5 * 60_000 - 1_000);
  await b.waitFor(`document.querySelector('dialog')?.open === true`, '두 번째 경고', 10_000);
  await sleep(300);
  await press(b, 'Enter');
  await sleep(1200);
  d = await dialog();
  const left2 = await b.evaluate(`Date.parse(JSON.parse(sessionStorage.getItem('${KEY}')).expiresAt) - Date.now()`);
  check(!d.open && left2 > 29 * 60_000, '"계속 이용하기"(Enter) 로 연장된다');

  // 4. 더 입력하고 만료
  await typeText(b, '등학교');
  await expireIn(2_500);
  await b.waitFor(`document.querySelector('dialog')?.innerText.includes('자동으로 종료되었습니다')`, '종료 안내', 15_000);
  await sleep(2500);
  d = await dialog();
  check(d.active === 'A' && d.text.includes('다시 본인확인'), '종료되면 "다시 본인확인" 링크가 포커스를 받는다');
  check(/\d{2}:\d{2}:\d{2}에 저장되었습니다/.test(d.text), `종료 안내가 마지막 저장 시각을 말한다 — "${d.text.split('\n').find((l) => l.includes('저장')) ?? ''}"`);
  check((await serverValue()) === '한국고등학교', '종료 순간의 마지막 입력까지 서버에 저장된다');
  await press(b, 'Escape');
  await sleep(300);
  check((await dialog()).open, 'Esc 로 종료 안내를 닫을 수 없다 — 끝난 신원으로 화면을 계속 쓰지 않는다');
  check((await b.evaluate(`sessionStorage.getItem('${KEY}')`)) === null, '세션이 지워진다');
  const ax = await axFocused(b);
  check(!!ax && ax.role === 'link', `종료 안내의 포커스 자리 — ${ax?.text}`);
} catch (err) {
  check(false, err.message);
} finally {
  b.close();
}

const result = {
  test: 'T-M5-45 Session Timeout 사전 경고',
  environment: '축소 환경 — 로컬 전용 DB(ui-shots-pg)·개발 서버. 만료 시각만 앞당겼다(세션 유지 30분·경고 5분 전)',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.resolve('tests/a11y/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `session-timeout-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 세션 만료 경고 — 문제 ${problems.length}건 → ${path.relative(process.cwd(), file)}`);
process.exitCode = result.passed ? 0 : 1;
