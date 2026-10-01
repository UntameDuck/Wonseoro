// T-M5-46 CAPTCHA 대체수단 — 요청 한도에 걸린 사람이 퍼즐 없이, 키보드·스크린리더로 지나갈 수 있는가 (ADR-0009)
//
// 사용: node tests/a11y/rate-limit.mjs
// 서버의 검증 응답 **한 번만** 429 RATE_LIMITED(Retry-After 6초)로 바꾼다 — 위험점수를 실제로 올리려면 남의 원서를
// 수십 번 훑어야 해서다. 화면 쪽 동작은 실제다.
//   - 화면이 장애 안내로 바뀌지 않는다(단계·입력 그대로)
//   - 안내가 포커스를 받고 "HH:MM:SS부터 다시 누를 수 있습니다" 와 요청번호를 말한다. 누른 버튼은 그때까지 쉰다
//   - 시각이 되면 같은 알림 영역에서 "이제 다시 시도할 수 있습니다" 로 바뀌고 버튼이 열린다 — 키보드로 이어 간다
//   - 퍼즐(그림·소리·끌기)이 없다
// 서버는 keyboard-walk 와 같다. 결과는 tests/a11y/results/rate-limit-<시각>.json
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { focusInfo, launch, press, sleep } from './helpers/browser.mjs';
import { axFocused } from './helpers/ax.mjs';

const WEB = 'http://localhost:4001';
const API = 'http://localhost:3101';
const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what) => {
  steps.push({ ok, what });
  console.log(`${ok ? '✔' : '✘'} ${what}`);
  if (!ok) problems.push(what);
};

// 준비 — 새 지원자와 원서(API)
const a = { applicantId: randomUUID(), subjectToken: `subj-limit-${Date.now()}` };
execFileSync('docker', [
  'exec', 'ui-shots-pg', 'psql', '-q', '-U', 'wonseoro', '-d', 'univ_a', '-v', 'ON_ERROR_STOP=1', '-c',
  `INSERT INTO kadmission.applicant (id, subject_token, pii_ciphertext, pii_key_version) VALUES ('${a.applicantId}', '${a.subjectToken}', '\\x00', 'v1')`,
]);
const h = { 'x-applicant-id': a.applicantId, 'x-subject-token': a.subjectToken };
const cycle = await (await fetch(`${API}/api/v1/admission-cycles/current`, { headers: h })).json();
const types = await (await fetch(`${API}/api/v1/admission-types?cycleId=${cycle.id}`, { headers: h })).json();
const depts = await (await fetch(`${API}/api/v1/departments?cycleId=${cycle.id}`, { headers: h })).json();
const applicationId = (
  await (
    await fetch(`${API}/api/v1/applications`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json', 'idempotency-key': `limit-${randomUUID()}` },
      body: JSON.stringify({ cycleId: cycle.id, admissionTypeId: types[0].id, departmentId: depts[0].id }),
    })
  ).json()
).id;

const b = await launch({ width: 1280, height: 900, port: 9341 });
async function keyTo(name, max = 60) {
  for (let i = 0; i < max; i++) {
    await press(b, 'Tab');
    if ((await focusInfo(b)).name === name) return;
  }
  throw new Error(`키보드로 닿지 못했다: ${name}`);
}

try {
  await b.send('Page.navigate', { url: `${WEB}/` });
  await b.waitFor(`document.readyState === 'complete'`, '홈');
  await b.evaluate(`sessionStorage.setItem('wonseoro.dev.session', ${JSON.stringify(JSON.stringify({ ...a, applicationId }))})`);
  await b.send('Page.navigate', { url: `${WEB}/apply/${applicationId}` });
  await b.waitFor(`document.body.innerText.includes('1. 공통정보')`, '1단계', 60_000);
  await sleep(600);
  for (const title of ['2. 대학·전형', '3. 추가정보', '4. 서류']) {
    await keyTo('다음 단계');
    await press(b, 'Enter');
    await b.waitFor(`document.body.innerText.includes(${JSON.stringify(title)})`, title);
  }

  // 검증 요청 한 번만 429 로
  let limited = 0;
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/validate*', requestStage: 'Request' }] });
  b.on('Fetch.requestPaused', async (e) => {
    if (e.request.method === 'POST' && limited === 0) {
      limited += 1;
      const problem = { type: 'about:blank', title: '요청이 많습니다', status: 429, code: 'RATE_LIMITED', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' };
      await b.send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 429,
        responseHeaders: [
          { name: 'content-type', value: 'application/problem+json' },
          { name: 'retry-after', value: '6' },
          { name: 'access-control-allow-origin', value: WEB },
          { name: 'access-control-expose-headers', value: 'retry-after, etag' },
        ],
        body: Buffer.from(JSON.stringify(problem)).toString('base64'),
      });
    } else {
      await b.send('Fetch.continueRequest', { requestId: e.requestId });
    }
  });

  await keyTo('검토 단계로');
  await press(b, 'Enter');
  await b.waitFor(`document.body.innerText.includes('요청이 많아 잠시 멈췄습니다')`, '한도 안내', 15_000);
  await sleep(400);
  const page = await b.evaluate(`({ step: document.body.innerText.includes('4. 서류'), failure: document.body.innerText.includes('작성하신 내용은 보관되어 있습니다. 처음부터') })`);
  check(page.step && !page.failure, '화면이 장애 안내로 바뀌지 않는다 — 4단계 그대로');
  const say = await axFocused(b);
  check(say?.role === 'status' && /\d{2}:\d{2}:\d{2}부터 다시 누를 수 있습니다/.test(say?.name + ' ' + say?.description + ' ' + (await b.evaluate('document.activeElement.innerText'))),
    `안내가 포커스를 받고 다시 누를 시각을 말한다 — ${(await b.evaluate('document.activeElement.innerText')).replace(/\s+/g, ' ').slice(0, 90)}`);
  check((await b.evaluate(`document.activeElement.innerText`)).includes('4bf92f3577b34da6a3ce929d0e0e4736'), '문의할 요청번호를 함께 보인다');
  check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '검토 단계로')?.disabled === true`), '그 시각까지 "검토 단계로" 가 쉰다');
  await b.evaluate(`document.activeElement.dataset.limitRegion = '1'`);

  await sleep(6500);
  const after = await b.evaluate(`(() => { const r = document.querySelector('[data-limit-region]'); return { same: !!r, text: r?.innerText ?? '', role: r?.getAttribute('role') }; })()`);
  check(after.same && after.text.includes('이제 다시 시도할 수 있습니다') && after.role === 'status', '시각이 되면 같은 알림 영역이 "이제 다시 시도할 수 있습니다" 로 바뀐다(스크린리더가 읽는다)');
  check(await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '검토 단계로')?.disabled === false`), '버튼이 다시 열린다');
  await keyTo('검토 단계로');
  await press(b, 'Enter');
  await b.waitFor(`document.body.innerText.includes('입력을 확인해 주십시오') || document.body.innerText.includes('결제가 확인되면')`, '검증 결과', 15_000);
  check(true, '키보드로 다시 눌러 검증이 진행된다');
  const puzzle = await b.evaluate(`[...document.querySelectorAll('iframe, canvas, audio, [class*=captcha], [id*=captcha]')].length`);
  check(puzzle === 0, '퍼즐(그림·소리·끌기·외부 CAPTCHA 틀)이 없다');
} catch (err) {
  check(false, err.message);
} finally {
  b.close();
}

const result = {
  test: 'T-M5-46 CAPTCHA 대체수단 — 접근 가능한 한도 해제 경로',
  environment: '축소 환경 — 로컬 전용 DB·개발 서버. 검증 응답 한 번만 429(Retry-After 6초)로 바꿨다',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.resolve('tests/a11y/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `rate-limit-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 한도 해제 경로 — 문제 ${problems.length}건 → ${path.relative(process.cwd(), file)}`);
process.exitCode = result.passed ? 0 : 1;
