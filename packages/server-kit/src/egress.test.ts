import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { EgressDenied, EgressPolicy } from './egress';
import { InternalHttpClient } from './mtls';

const denied = (fn: () => unknown, reason: string) =>
  assert.throws(fn, (e: unknown) => e instanceof EgressDenied && e.reason === reason);

describe('출구 허용 목록 — 요청 전 (T-M5-07)', () => {
  const p = new EgressPolicy({ allow: ['sync.k-admission.kr', 'object-storage:9000', '*.objectstorage.kr', '169.254.169.254'], allowLoopback: false });

  it('허용된 호스트만 — 다른 호스트·다른 포트는 거절', () => {
    assert.equal(p.check('https://sync.k-admission.kr/internal/v1/events').hostname, 'sync.k-admission.kr');
    assert.equal(p.check('http://object-storage:9000/bucket/key?X-Amz-Signature=x').port, '9000');
    assert.equal(p.check('https://univ-a.objectstorage.kr/doc').hostname, 'univ-a.objectstorage.kr');
    denied(() => p.check('https://evil.example.com/'), 'host');
    denied(() => p.check('http://object-storage:9001/'), 'host');
    denied(() => p.check('https://objectstorage.kr/'), 'host'); // *.suffix 는 그 이름 자체를 포함하지 않는다
    denied(() => p.check('https://sync.k-admission.kr.evil.com/'), 'host');
    denied(() => p.check('https://SYNC.K-ADMISSION.KR@evil.com/'), 'host'); // 사용자 정보로 호스트를 속이기
  });

  it('http·https 만 — file·gopher·data 는 거절', () => {
    for (const u of ['file:///etc/passwd', 'gopher://sync.k-admission.kr/', 'data:text/plain,x', 'ftp://object-storage:9000/']) denied(() => p.check(u), 'scheme');
    denied(() => p.check('not a url'), 'scheme');
  });

  it('메타데이터 주소는 허용 목록에 있어도 거절 — 숫자 표기·IPv6 로 감싸도', () => {
    denied(() => p.check('http://169.254.169.254/latest/meta-data/'), 'address');
    assert.equal(p.deniedAddress('169.254.169.254'), true);
    assert.equal(p.deniedAddress('::ffff:169.254.169.254'), true);
    assert.equal(p.deniedAddress('fd00:ec2::254'), true);
    assert.equal(p.deniedAddress('100.100.100.200'), true);
    assert.equal(p.deniedAddress('0.0.0.0'), true);
    assert.equal(p.deniedAddress('127.0.0.1'), true, '운영(루프백 금지)');
    assert.equal(p.deniedAddress('10.0.12.7'), false, '사설 대역은 클러스터 안 의존 서비스 — 이름 허용 목록이 좁힌다');
  });

  it('설정된 URL 들의 호스트로 만든다 — 비었거나 틀린 URL 은 건너뛴다', () => {
    const q = EgressPolicy.fromUrls(['https://sync.k-admission.kr/internal/v1/events', 'http://object-storage:9000', '', null, 'not a url'], ['pg.example.kr']);
    assert.deepEqual([...q.allow].sort(), ['object-storage:9000', 'pg.example.kr', 'sync.k-admission.kr']);
  });
});

describe('출구 허용 목록 — 연결 순간의 주소 (DNS 재바인딩)', () => {
  it('허용된 이름이 막힌 주소로 풀리면 연결하지 않는다', async () => {
    const server = createServer((_q, s) => s.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      // 운영 정책 — localhost 는 허용 목록에 있지만 127.0.0.1 로 풀린다 → 막힌 주소
      const prod = new InternalHttpClient(null, new EgressPolicy({ allow: [`localhost:${port}`], allowLoopback: false }));
      await assert.rejects(prod.fetch(`http://localhost:${port}/`), (e: unknown) => {
        const cause = (e as { cause?: unknown }).cause;
        return e instanceof EgressDenied || cause instanceof EgressDenied || String((cause as Error)?.message).includes('허용되지 않은 출구');
      });
      // 개발 정책(루프백 허용)이면 같은 요청이 된다
      const dev = new InternalHttpClient(null, new EgressPolicy({ allow: [`localhost:${port}`], allowLoopback: true }));
      assert.equal(await (await dev.fetch(`http://localhost:${port}/`)).text(), 'ok');
      // 허용 목록 밖 호스트는 연결 전에 거절
      await assert.rejects(dev.fetch(`http://127.0.0.2:${port}/`), EgressDenied);
    } finally {
      server.close();
    }
  });
});
