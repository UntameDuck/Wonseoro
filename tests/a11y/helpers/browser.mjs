// 접근성 시험용 브라우저 — 설치 없이 이 PC 의 Chrome(또는 Edge)을 헤드리스로 띄워 DevTools 프로토콜(CDP)로 조작한다.
//
// 화면 캡처(scripts/screenshots/capture.mjs)와 같은 방식이다. 다른 점은 **키보드 입력만** 쓴다는 것 —
// 요소를 찾아 click() 하지 않고, Tab·Enter·Space 키 이벤트를 보내 사람이 키보드로 하는 그대로 움직인다.
//   CHROME=<실행 파일>  다른 Chromium 계열(Edge)로 돌린다 (T-M5-47)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};

/**
 * 브라우저를 띄우고 첫 탭에 붙는다.
 * @param {{ width: number, height: number, port?: number, executable?: string, profile?: string }} o
 */
export async function launch({ width, height, port = 9334, executable, profile = 'a11y' }) {
  const work = path.join(os.tmpdir(), 'wonseoro-a11y');
  mkdirSync(work, { recursive: true });
  const exe = executable ?? process.env.CHROME ?? BROWSERS.chrome;
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      // 실행마다 새 프로필 — 앞선 실행의 세션 저장소가 남지 않게
      `--user-data-dir=${path.join(work, `${profile}-${Date.now()}`)}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--lang=ko-KR',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let targets = null;
  for (let i = 0; i < 75 && !targets; i++) {
    await sleep(200);
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      /* 아직 안 떴다 */
    }
  }
  if (!targets) throw new Error(`브라우저가 뜨지 않았다: ${exe}`);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
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
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  }
  function on(method, fn) {
    listeners.set(method, [...(listeners.get(method) ?? []), fn]);
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });

  return {
    browser: version.Browser,
    send,
    on,
    evaluate,
    waitFor,
    close() {
      ws.close();
      proc.kill();
    },
  };
}

/* ── 키보드 ──────────────────────────────────────────────────────────── */

const KEYS = {
  Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ' ': { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
};

/** 키 하나를 누르고 뗀다. shift 면 Shift 를 함께 누른다(Shift+Tab). */
export async function press(b, key, { shift = false } = {}) {
  const k = KEYS[key];
  if (!k) throw new Error(`모르는 키: ${key}`);
  const modifiers = shift ? 8 : 0;
  await b.send('Input.dispatchKeyEvent', {
    type: k.text ? 'keyDown' : 'rawKeyDown',
    key,
    code: k.code,
    windowsVirtualKeyCode: k.windowsVirtualKeyCode,
    modifiers,
    ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}),
  });
  await b.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: k.code,
    windowsVirtualKeyCode: k.windowsVirtualKeyCode,
    modifiers,
  });
  await sleep(60);
}

/** 포커스된 칸에 글자를 넣는다 — 한글 입력기가 글자를 확정하는 것과 같은 경로(insertText)다. */
export async function typeText(b, text) {
  await b.send('Input.insertText', { text });
  await sleep(60);
}

/** 포커스된 칸의 글을 모두 고른다(Ctrl+A) — 이어서 typeText 하면 바꿔 쓴다. */
export async function selectAll(b) {
  await b.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 2,
    commands: ['selectAll'],
  });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
}

/**
 * 지금 포커스가 있는 요소. 이름은 사람이 읽는 이름(라벨·글자·aria-label)이다.
 * visible: 포커스 표시가 보이는가 — 테두리(outline) 2px 이상 또는 그림자 (T-M5-41)
 */
export const FOCUS_INFO = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { tag: 'BODY', name: '', body: true };
  const clean = (t) => (t || '').replace('필수 입력', '').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim();
  const name = clean(
    el.getAttribute('aria-label') ||
    (el.labels && el.labels.length ? el.labels[0].textContent : '') ||
    el.innerText || el.textContent || el.value || '',
  );
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    type: el.getAttribute('type') || '',
    id: el.id || '',
    role: el.getAttribute('role') || '',
    name: name.slice(0, 80),
    visible: outline || !!shadow,
    focusVisible: el.matches(':focus-visible'),
    inMain: !!el.closest('main'),
    inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    checked: el.type === 'checkbox' ? el.checked : undefined,
  };
})()`;

export const focusInfo = (b) => b.evaluate(FOCUS_INFO);
