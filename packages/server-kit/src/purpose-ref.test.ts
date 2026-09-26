import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { parseKeyRing, purposeRef } from './purpose-ref';

const k1 = { id: 'k1', secret: 'dashboard-secret-1' };
const token = 'subj-9f2c1a7e4b';

describe('목적별 가명 참조 (v1.1 §A12)', () => {
  it('같은 사람·같은 키면 대학이 달라도 같은 값이다 — "내 원서" 를 모을 수 있다', () => {
    assert.equal(purposeRef('DASHBOARD', k1, token), purposeRef('DASHBOARD', k1, token));
  });

  it('토큰만으로는 다시 만들 수 없다 — Vault 를 읽어도 조인되지 않는다', () => {
    const ref = purposeRef('DASHBOARD', k1, token);
    // 전의 방식. Vault 의 토큰을 해시하면 그대로 나왔다.
    const naive = createHash('sha256').update(token).digest('hex');
    assert.notEqual(ref.split('.')[1], naive);
    assert.notEqual(ref, purposeRef('DASHBOARD', { id: 'k1', secret: 'guess' }, token));
  });

  it('어느 키로 만들었는지 참조에 드러나고, 기존 컬럼(64자)에 들어간다', () => {
    const ref = purposeRef('DASHBOARD', k1, token);
    assert.match(ref, /^k1\.[A-Za-z0-9_-]{43}$/);
    assert.ok(ref.length <= 64);
    assert.notEqual(ref, purposeRef('DASHBOARD', { id: 'k2', secret: 'dashboard-secret-2' }, token));
  });

  it('키 목록은 첫 번째가 현재 키다', () => {
    assert.deepEqual(parseKeyRing(' k2=new , k1=old '), [
      { id: 'k2', secret: 'new' },
      { id: 'k1', secret: 'old' },
    ]);
  });

  it('형식이 틀린 키 목록은 기동 시점에 거절한다', () => {
    assert.throws(() => parseKeyRing(''));
    assert.throws(() => parseKeyRing('k1'));
    assert.throws(() => parseKeyRing('k1='));
    assert.throws(() => parseKeyRing('k1=a,k1=b'));
    assert.throws(() => parseKeyRing('키=a'));
  });
});
