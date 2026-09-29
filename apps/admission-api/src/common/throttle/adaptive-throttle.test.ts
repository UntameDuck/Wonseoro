import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AdaptiveThrottle, classifyRoute, RISK } from './adaptive-throttle';

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('Adaptive Throttling (T-M4-40, §01 B6)', () => {
  it('정상 사용자 — 30분 동안 3초마다 자동저장·가끔 조회해도 한 번도 막히지 않는다', () => {
    const c = clock();
    const t = new AdaptiveThrottle({ now: c.now });
    for (let i = 0; i < 600; i += 1) {
      assert.equal(t.check('student', 'save', 'app-1').allowed, true, `save ${i}`);
      if (i % 5 === 0) assert.equal(t.check('student', 'read', 'app-1').allowed, true);
      c.advance(3_000);
    }
    assert.equal(t.riskOf('student'), 0);
  });

  it('최종제출은 정상 세션에서 절대 막지 않는다 — 마감 직전 연타도 (§8.4)', () => {
    const t = new AdaptiveThrottle({ now: clock().now });
    for (let i = 0; i < 200; i += 1) assert.equal(t.check('student', 'finalize', 'app-1').allowed, true);
  });

  it('짧은 폭주는 버킷 크기까지 받고 나머지는 BURST + Retry-After', () => {
    const t = new AdaptiveThrottle({ now: clock().now });
    const results = Array.from({ length: 40 }, () => t.check('bot', 'save', 'app-1'));
    assert.equal(results.filter((r) => r.allowed).length, 30);
    const denied = results.find((r) => !r.allowed);
    assert.ok(denied && !denied.allowed && denied.reason === 'BURST' && denied.retryAfterSeconds >= 1);
  });

  it('남의 원서를 훑으면 위험점수가 올라 변경 요청이 멈추고, 조회는 계속된다. 시간이 지나면 풀린다', () => {
    const c = clock();
    const t = new AdaptiveThrottle({ now: c.now });
    for (let i = 0; i < 8; i += 1) t.noteOwnershipMiss('prober');
    assert.ok(t.riskOf('prober') >= RISK.high);
    const blocked = t.check('prober', 'save', 'own-app');
    assert.ok(!blocked.allowed && blocked.reason === 'RISK');
    assert.equal(t.check('prober', 'read', 'own-app').allowed, true, '조회는 막지 않는다');

    c.advance(blocked.retryAfterSeconds * 1000);
    assert.equal(t.check('prober', 'save', 'own-app').allowed, true, 'Retry-After 뒤에는 다시 된다');
  });

  it('위험이 높아도 최종제출은 넉넉한 별도 한도로 받는다 — 멱등이라 중복 접수는 없다', () => {
    const t = new AdaptiveThrottle({ now: clock().now });
    for (let i = 0; i < 8; i += 1) t.noteOwnershipMiss('prober');
    const results = Array.from({ length: 8 }, () => t.check('prober', 'finalize', 'own-app'));
    assert.equal(results.filter((r) => r.allowed).length, 5);
  });

  it('짧은 시간에 많은 원서를 건드리면(전형 수 초과) 위험점수가 오른다', () => {
    const t = new AdaptiveThrottle({ now: clock().now });
    for (let i = 0; i < RISK.distinctApplicationsAllowed; i += 1) t.check('student', 'read', `app-${i}`);
    assert.equal(t.riskOf('student'), 0, '전형 수만큼은 정상이다');
    for (let i = 0; i < 5; i += 1) t.check('scraper', 'read', `other-${i}`);
    for (let i = 5; i < 12; i += 1) t.check('scraper', 'read', `other-${i}`);
    assert.ok(t.riskOf('scraper') >= RISK.high);
  });

  it('NAT — 같은 IP 뒤 정상 200명과 봇이 섞여도 정상 사용자는 막히지 않는다 (IP 는 키가 아니다)', () => {
    const c = clock();
    const t = new AdaptiveThrottle({ now: c.now });
    let normalDenied = 0;
    let botDenied = 0;
    for (let second = 0; second < 120; second += 1) {
      for (let s = 0; s < 200; s += 1) {
        if ((second + s) % 4 === 0 && !t.check(`student-${s}`, 'save', `app-${s}`).allowed) normalDenied += 1;
      }
      for (let k = 0; k < 20; k += 1) if (!t.check('bot', 'save', 'bot-app').allowed) botDenied += 1;
      c.advance(1_000);
    }
    assert.equal(normalDenied, 0);
    assert.ok(botDenied > 2000, `봇 거절 ${botDenied}`);
  });

  it('추적하는 지원자 수에 상한이 있다 — 오래 안 본 지원자부터 잊는다', () => {
    const t = new AdaptiveThrottle({ now: clock().now, maxSubjects: 3 });
    for (const s of ['a', 'b', 'c', 'd']) t.check(s, 'read');
    assert.equal(t.trackedSubjects, 3);
  });
});

describe('경로 분류', () => {
  it('지원자 경로만 보고 헬스·관리자·내부·PG 콜백·익명 공개 조회는 보지 않는다', () => {
    assert.equal(classifyRoute('GET', '/healthz'), null);
    assert.equal(classifyRoute('POST', '/admin/v1/deadline-policies'), null);
    assert.equal(classifyRoute('GET', '/internal/v1/documents/pending-scan'), null);
    assert.equal(classifyRoute('POST', '/api/v1/payments/callbacks/:provider'), null);
    assert.equal(classifyRoute('GET', '/api/v1/admission-cycles/current'), null);
    assert.equal(classifyRoute('GET', '/api/v1/meta/time'), null);
    assert.equal(classifyRoute('GET', undefined), null);
  });

  it('요청 종류', () => {
    assert.equal(classifyRoute('POST', '/api/v1/applications'), 'create');
    assert.equal(classifyRoute('PATCH', '/api/v1/applications/:applicationId'), 'save');
    assert.equal(classifyRoute('GET', '/api/v1/applications/:applicationId'), 'read');
    assert.equal(classifyRoute('POST', '/api/v1/applications/:applicationId/validate'), 'read');
    assert.equal(classifyRoute('POST', '/api/v1/applications/:applicationId/finalize'), 'finalize');
    assert.equal(classifyRoute('POST', '/api/v1/applications/:applicationId/cancel'), 'cancel');
    assert.equal(classifyRoute('POST', '/api/v1/applications/:applicationId/payment-intents'), 'payment');
    assert.equal(classifyRoute('POST', '/api/v1/payments/:paymentId/verify'), 'payment');
    assert.equal(classifyRoute('POST', '/api/v1/documents/:documentId/complete'), 'upload');
  });
});
