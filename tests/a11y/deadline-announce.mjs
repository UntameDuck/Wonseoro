// T-M5-42 마감 경고 알림 — 남은 시간은 매초 바뀌지만 스크린리더 알림은 경고 단계(30·10·5·1분 전)가 바뀔 때만 한다.
//
// 사용: node tests/a11y/deadline-announce.mjs
// 마감이 가까운 상황을 만들려고 브라우저가 받는 서버 시각 응답(/meta/time)만 바꾼다 — 남은 시간 10분 3초.
// 8초 동안 0.25초마다 알림 영역의 글을 모아, 바뀐 횟수와 카운트다운이 알림 영역에 들어갔는지를 본다.
// 서버 DB 의 마감은 건드리지 않는다. 원서 화면은 keyboard-walk 가 완주한 가장 최근 원서를 연다.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './helpers/browser.mjs';

const WEB = 'http://localhost:4001';
const walk = readdirSync(path.resolve('tests/a11y/results'))
  .filter((f) => f.startsWith('keyboard-walk-'))
  .map((f) => JSON.parse(readFileSync(path.resolve('tests/a11y/results', f), 'utf8')))
  .filter((r) => r.completed && r.applicationId)
  .sort((x, y) => x.at.localeCompare(y.at))
  .at(-1);
if (!walk) {
  console.error('keyboard-walk 완주 결과가 없다 — 먼저 npm run test:a11y:keyboard');
  process.exit(2);
}

const b = await launch({ width: 1280, height: 900, port: 9336 });
const problems = [];
try {
  await b.send('Page.navigate', { url: `${WEB}/` });
  await b.waitFor(`document.readyState === 'complete'`, '홈');
  await b.evaluate(`sessionStorage.setItem('wonseoro.dev.session', ${JSON.stringify(JSON.stringify({ ...walk.applicant, applicationId: walk.applicationId }))})`);

  // 서버 시각 응답을 가로채 남은 시간만 바꾼다
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/meta/time*', requestStage: 'Response' }] });
  b.on('Fetch.requestPaused', async (e) => {
    // 요청번호 헤더 때문에 사전 확인(OPTIONS)이 먼저 온다 — 그대로 보낸다
    if (e.request.method !== 'GET') {
      await b.send('Fetch.continueRequest', { requestId: e.requestId });
      return;
    }
    const body = JSON.parse(Buffer.from((await b.send('Fetch.getResponseBody', { requestId: e.requestId })).body, 'base64').toString());
    const remainingMs = 10 * 60_000 + 3_000;
    const changed = { ...body, remainingMs, warningMinutes: 30, deadlineAt: new Date(Date.parse(body.serverTime) + remainingMs).toISOString() };
    await b.send('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: 200,
      responseHeaders: e.responseHeaders,
      body: Buffer.from(JSON.stringify(changed)).toString('base64'),
    });
  });

  await b.send('Page.navigate', { url: `${WEB}/apply/${walk.applicationId}` });
  await b.waitFor(`document.body.innerText.includes('남음')`, '마감 배너', 60_000);

  const samples = [];
  for (let i = 0; i < 32; i++) {
    samples.push(
      await b.evaluate(`(() => ({
        visible: [...document.querySelectorAll('main strong')].map((e) => e.innerText).find((t) => t.includes('남음')) ?? '',
        live: [...document.querySelectorAll('[role=status], [role=alert], [aria-live]')]
          .filter((e) => e.getAttribute('aria-live') !== 'off')
          .map((e) => ({ text: (e.innerText || e.textContent || '').trim(), live: e.getAttribute('aria-live') || (e.getAttribute('role') === 'alert' ? 'assertive' : 'polite') }))
          .filter((r) => r.text.includes('마감') || r.text.includes('남음')),
      }))()`),
    );
    await sleep(250);
  }

  const visibleChanges = new Set(samples.map((s) => s.visible)).size;
  const announcements = [...new Set(samples.flatMap((s) => s.live.map((r) => `${r.live}: ${r.text}`)))];
  const countdownInLive = samples.some((s) => s.live.some((r) => /남음/.test(r.text)));
  console.log(`화면의 남은 시간 — 8초 동안 ${visibleChanges}가지로 바뀜 (예: ${samples[0].visible} → ${samples.at(-1).visible})`);
  console.log('스크린리더 알림:');
  for (const a of announcements) console.log(`  ${a}`);
  if (countdownInLive) problems.push('남은 시간 카운트다운이 알림 영역 안에 있다 — 스크린리더가 매초 읽는다');
  if (visibleChanges < 5) problems.push(`화면의 남은 시간이 매초 바뀌지 않았다(${visibleChanges}가지) — 시험 조건이 맞지 않는다`);
  if (!announcements.some((a) => a.startsWith('polite') && a.includes('30분 전'))) problems.push('30분 전 경고를 차례를 기다려(polite) 알리지 않았다');
  if (!announcements.some((a) => a.startsWith('assertive') && a.includes('10분 전'))) problems.push('10분 전 경고를 바로(assertive) 알리지 않았다');
  if (announcements.length > 2) problems.push(`알림이 ${announcements.length}번 바뀌었다 — 경고 단계가 바뀔 때만 알려야 한다`);
} catch (err) {
  problems.push(err.message);
} finally {
  b.close();
}
for (const p of problems) console.error(`✘ ${p}`);
console.log(problems.length ? '✘ 마감 경고 알림 시험 실패' : '✔ 마감 경고 알림 — 카운트다운은 읽지 않고, 경고 단계가 바뀔 때만(30분 전 polite → 10분 전 assertive) 알린다 · 축소 환경');
process.exitCode = problems.length ? 1 : 0;
