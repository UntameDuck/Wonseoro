import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';

// 임시 파일은 저장소 .cache 에 둔다 — 시스템 임시 폴더는 이 PC 에서 C 드라이브다
const WORK = resolve(__dirname, '../../../.cache/test-mtls');
mkdirSync(WORK, { recursive: true });
import { after, before, describe, it } from 'node:test';
import { InternalHttpClient, parseWorkloadUri, peerIdentity, serverTlsOptions, watchServerTls, type MtlsFiles } from './mtls';

describe('워크로드 신원 URI', () => {
  it('대학·중앙 신원을 읽는다', () => {
    assert.deepEqual(parseWorkloadUri('spiffe://wonseoro/university/UNIV-A/event-relay'), {
      zone: 'university', universityId: 'UNIV-A', workload: 'event-relay', uri: 'spiffe://wonseoro/university/UNIV-A/event-relay',
    });
    assert.equal(parseWorkloadUri('spiffe://wonseoro/central/central-api')?.zone, 'central');
  });

  it('모양이 다르면 신원이 아니다 — 다른 신뢰 영역·경로 덧붙이기·소문자 대학', () => {
    for (const bad of [
      'spiffe://evil/university/UNIV-A/event-relay',
      'spiffe://wonseoro/university/UNIV-A/event-relay/extra',
      'spiffe://wonseoro/university/univ-a/event-relay',
      'spiffe://wonseoro/university//event-relay',
      'https://wonseoro/university/UNIV-A/event-relay',
    ]) assert.equal(parseWorkloadUri(bad), null, bad);
  });

  it('평문 연결에는 신원이 없다', () => {
    assert.deepEqual(peerIdentity({ encrypted: false }), { identity: null, problem: 'plaintext' });
    assert.deepEqual(peerIdentity(undefined), { identity: null, problem: 'plaintext' });
  });
});

let opensslOk = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  opensslOk = false;
}

describe('실제 TLS — 상대 인증서의 신원 (openssl 필요)', { skip: opensslOk ? false : 'openssl 이 없다' }, () => {
  let dir = '';
  let pki: Record<string, { cert: string; key: string } | string> = {};
  let server: Server;
  let base = '';
  const files = (name: string): MtlsFiles => {
    const w = pki[name] as { cert: string; key: string };
    return { certFile: w.cert, keyFile: w.key, caFile: pki.ca as string };
  };

  before(async () => {
    dir = mkdtempSync(join(WORK, 'pki-'));
    const mod = (await import(resolve(__dirname, '../../../scripts/pki/dev-pki.mjs'))) as {
      createDevPki: (o: { out: string; hours: number }) => Record<string, { cert: string; key: string } | string>;
    };
    pki = mod.createDevPki({ out: dir, hours: 1 });
    server = createServer(serverTlsOptions(files('central-api')), (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(peerIdentity(req.socket)));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `https://localhost:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const ask = async (client: InternalHttpClient) => (await client.fetch(`${base}/`)).json() as Promise<ReturnType<typeof peerIdentity>>;

  it('플랫폼 CA 가 서명한 인증서 — 신원이 읽힌다', async () => {
    const r = await ask(new InternalHttpClient(files('univ-a-event-relay')));
    assert.equal(r.problem, null);
    assert.equal(r.identity?.universityId, 'UNIV-A');
    assert.equal(r.identity?.workload, 'event-relay');
  });

  it('인증서 없이 오면 연결은 되지만 신원이 없다 — 공개 경로는 그대로 쓴다', async () => {
    // 서버 인증서를 믿게 하되 클라이언트 인증서는 내지 않는다
    const { Agent, fetch: f } = await import('undici');
    const agent = new Agent({ connect: { ca: readFileSync(pki.ca as string) } });
    const r = (await (await f(`${base}/`, { dispatcher: agent })).json()) as ReturnType<typeof peerIdentity>;
    assert.equal(r.problem, 'no-certificate');
    await agent.close();
  });

  it('다른 CA 가 서명한 같은 이름의 인증서는 믿지 않는다', async () => {
    const rogue = pki['rogue-univ-a-relay'] as { cert: string; key: string };
    const r = await ask(new InternalHttpClient({ certFile: rogue.cert, keyFile: rogue.key, caFile: pki.ca as string }));
    assert.equal(r.problem, 'untrusted');
    assert.equal(r.identity, null);
  });

  it('클라이언트는 플랫폼 CA 가 아닌 서버를 믿지 않는다', async () => {
    const rogue = pki['rogue-univ-a-relay'] as { cert: string; key: string };
    const fake = createServer({ key: readFileSync(rogue.key), cert: readFileSync(rogue.cert) }, (_q, s) => s.end('{}'));
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const client = new InternalHttpClient(files('univ-a-event-relay'));
    await assert.rejects(client.fetch(`https://localhost:${(fake.address() as AddressInfo).port}/`));
    fake.close();
  });

  it('서버 인증서 파일이 바뀌면 재기동 없이 새 인증서를 쓴다', async () => {
    const live = mkdtempSync(join(WORK, 'live-'));
    const f: MtlsFiles = { certFile: join(live, 'tls.crt'), keyFile: join(live, 'tls.key'), caFile: join(live, 'ca.crt') };
    const central = pki['central-api'] as { cert: string; key: string };
    copyFileSync(central.cert, f.certFile);
    copyFileSync(central.key, f.keyFile);
    copyFileSync(pki.ca as string, f.caFile);
    const srv = createServer(serverTlsOptions(f), (_q, s) => s.end('{}'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const stop = watchServerTls(srv, f, 50);
    const serial = async () => {
      const tls = await import('node:tls');
      return new Promise<string>((res, rej) => {
        const sock = tls.connect({ port: (srv.address() as AddressInfo).port, host: '127.0.0.1', servername: 'localhost', ca: readFileSync(f.caFile) }, () => {
          res(sock.getPeerCertificate().serialNumber);
          sock.end();
        });
        sock.on('error', rej);
      });
    };
    const before = await serial();
    // 같은 CA 로 새로 발급한 인증서(교체)를 파일에 덮어쓴다
    const again = (await import(resolve(__dirname, '../../../scripts/pki/dev-pki.mjs'))) as {
      createDevPki: (o: { out: string; hours: number; workloads: { name: string; uri: string; dns: string[] }[] }) => Record<string, { cert: string; key: string } | string>;
    };
    const next = again.createDevPki({ out: join(live, 'next'), hours: 1, workloads: [{ name: 'central-api', uri: 'spiffe://wonseoro/central/central-api', dns: ['localhost'] }] });
    const nc = next['central-api'] as { cert: string; key: string };
    copyFileSync(next.ca as string, f.caFile);
    copyFileSync(nc.key, f.keyFile);
    copyFileSync(nc.cert, f.certFile);
    await new Promise((r) => setTimeout(r, 300));
    const afterSerial = await serial();
    assert.notEqual(afterSerial, before, '새 인증서로 바뀌어야 한다');
    stop();
    srv.close();
    rmSync(live, { recursive: true, force: true });
  });
});
