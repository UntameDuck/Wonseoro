import assert from 'node:assert/strict';
import test from 'node:test';
import { browserExecutable } from './browser.mjs';

test('CHROME 환경 변수를 가장 먼저 쓴다', () => {
  assert.equal(browserExecutable('chrome', { platform: 'linux', env: { CHROME: '/opt/test/chrome' } }), '/opt/test/chrome');
});

test('Windows 설치 폴더에서 존재하는 브라우저를 고른다', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };
  const exists = (candidate) => candidate.includes('Google\\Chrome');
  assert.equal(
    browserExecutable('chrome', { platform: 'win32', env, exists }),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  );
});

test('설치 경로를 못 찾으면 운영체제의 대표 PATH 명령을 쓴다', () => {
  assert.equal(browserExecutable('chrome', { platform: 'linux', env: {}, exists: () => false }), 'google-chrome');
  assert.equal(browserExecutable('edge', { platform: 'win32', env: {}, exists: () => false }), 'msedge.exe');
});

test('PATH에 실제로 있는 Linux 브라우저 후보를 고른다', () => {
  const env = { PATH: '/usr/local/bin:/usr/bin' };
  const exists = (candidate) => candidate === '/usr/bin/chromium';
  assert.equal(browserExecutable('chrome', { platform: 'linux', env, exists }), 'chromium');
});

test('Windows PATH와 PATHEXT의 실행 파일도 찾는다', () => {
  const env = { PATH: 'C:\\Tools;C:\\Windows', PATHEXT: '.EXE;.CMD' };
  const exists = (candidate) => candidate === 'C:\\Tools\\msedge.exe';
  assert.equal(browserExecutable('edge', { platform: 'win32', env, exists }), 'msedge.exe');
});

test('직접 지정한 브라우저 이름은 그대로 쓴다', () => {
  assert.equal(browserExecutable('custom-browser', { platform: 'linux', env: {} }), 'custom-browser');
});
