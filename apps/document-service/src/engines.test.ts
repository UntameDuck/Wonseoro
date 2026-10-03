import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttp, Server as HttpServer } from 'node:http';
import { createServer as createTcp, Server as TcpServer, Socket } from 'node:net';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { configureEgress, EgressDenied } from '@wonseoro/server-kit';
import { ClamAvEngine, EngineUnavailable, parseReply } from './engines';

/**
 * ClamAV 엔진 어댑터 — clamd INSTREAM 프로토콜 (T-M5-08, D-58)
 *
 * 실제 clamd 대신 같은 프로토콜로 말하는 가짜 clamd 를 세운다. 가짜는 받은 조각을 이어 붙여
 * 표준 시험 문자열(EICAR)이 있으면 FOUND, 크기 한도를 넘으면 ERROR, 아니면 OK 라고 답한다.
 * 확인하는 것은 **어댑터가 프로토콜을 지키는가**(길이 접두 조각·끝 표시·NUL 종료 응답)와
 * 판정·장애를 구분하는가다. 실제 clamd·서명 DB 로 도는 것은 별도 확인 대상이다.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const LIMIT = 64 * 1024;

let clamd: TcpServer;
let storage: HttpServer;
let clamdPort = 0;
let storageUrl = '';
const received: Buffer[] = [];

/** 가짜 clamd — zVERSION 과 zINSTREAM 만 안다. */
function fakeClamd(socket: Socket): void {
  let buf = Buffer.alloc(0);
  let mode: 'command' | 'stream' = 'command';
  let body = Buffer.alloc(0);
  socket.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (mode === 'command') {
      const end = buf.indexOf(0);
      if (end < 0) return;
      const cmd = buf.subarray(0, end).toString();
      buf = buf.subarray(end + 1);
      if (cmd === 'zVERSION') {
        socket.end('ClamAV 1.4.1/27411/Mon Sep 29 09:32:58 2026\0');
        return;
      }
      if (cmd !== 'zINSTREAM') {
        socket.end('UNKNOWN COMMAND\0');
        return;
      }
      mode = 'stream';
    }
    // [4바이트 길이][조각] … [0000]
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len === 0) {
        received.push(body);
        const text = body.toString('latin1');
        if (body.length > LIMIT) socket.end('INSTREAM size limit exceeded. ERROR\0');
        else if (text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) socket.end('stream: Eicar-Test-Signature FOUND\0');
        else socket.end('stream: OK\0');
        return;
      }
      if (buf.length < 4 + len) return;
      body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
      buf = buf.subarray(4 + len);
    }
  });
}

const files = new Map<string, Buffer>();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const target = (name: string, bytes: Buffer) => ({
  documentId: name,
  objectKey: `applications/x/${name}`,
  mediaType: 'application/pdf',
  sizeBytes: bytes.length,
  sha256: sha(bytes),
  downloadUrl: `${storageUrl}/${name}`,
});

before(async () => {
  clamd = createTcp(fakeClamd);
  await new Promise<void>((r) => clamd.listen(0, '127.0.0.1', () => r()));
  clamdPort = (clamd.address() as AddressInfo).port;

  storage = createHttp((req, res) => {
    const file = files.get((req.url ?? '').slice(1));
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    // 여러 조각으로 나눠 보낸다 — 어댑터가 조각마다 길이 접두를 붙이는지 본다
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    for (let i = 0; i < file.length; i += 1000) res.write(file.subarray(i, i + 1000));
    res.end();
  });
  await new Promise<void>((r) => storage.listen(0, '127.0.0.1', () => r()));
  storageUrl = `http://127.0.0.1:${(storage.address() as AddressInfo).port}`;
  // 가짜 저장소를 출구 허용 목록에 올린다 — 운영처럼 Object Storage 호스트만 부를 수 있다 (T-M5-07)
  configureEgress([storageUrl]);
});

after(async () => {
  await new Promise<void>((r) => clamd.close(() => r()));
  await new Promise<void>((r) => storage.close(() => r()));
});

describe('ClamAV 엔진 어댑터 (clamd INSTREAM)', () => {
  const engine = () => new ClamAvEngine('127.0.0.1', clamdPort, 5_000);

  it('엔진·서명 DB 버전을 clamd 에 묻는다 — 증적에 남는다', async () => {
    assert.match(await engine().version(), /^ClamAV 1\.4\.1\/27411\//);
  });

  it('깨끗한 파일은 CLEAN — 조각을 나눠 보내도 바이트가 그대로 간다', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5_000, 7)]);
    files.set('clean.pdf', pdf);
    assert.deepEqual(await engine().scan(target('clean.pdf', pdf)), { verdict: 'CLEAN' });
    assert.ok(received.at(-1)?.equals(pdf), 'clamd 가 받은 바이트가 원본과 같다');
  });

  it('악성코드는 MALICIOUS 와 서명 이름', async () => {
    const bad = Buffer.from(EICAR);
    files.set('eicar.pdf', bad);
    assert.deepEqual(await engine().scan(target('eicar.pdf', bad)), {
      verdict: 'MALICIOUS',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('검사하지 못한 파일(크기 한도 초과)은 ERROR — 통과시키지 않는다', async () => {
    const big = Buffer.alloc(LIMIT + 1, 1);
    files.set('big.pdf', big);
    const result = await engine().scan(target('big.pdf', big));
    assert.equal(result.verdict, 'ERROR');
  });

  it('저장소의 파일이 기록된 해시와 다르면 ERROR — 다른 바이트의 검사 결과를 붙이지 않는다', async () => {
    const pdf = Buffer.from('%PDF-1.7 original');
    files.set('swapped.pdf', Buffer.from('%PDF-1.7 swapped!'));
    assert.deepEqual(await engine().scan(target('swapped.pdf', pdf)), { verdict: 'ERROR', signature: 'CONTENT_MISMATCH' });
  });

  it('clamd 에 닿지 못하면 판정이 아니라 EngineUnavailable — 서류를 떨어뜨리지 않는다', async () => {
    const pdf = Buffer.from('%PDF-1.7');
    files.set('ok.pdf', pdf);
    await assert.rejects(new ClamAvEngine('127.0.0.1', 1, 1_000).scan(target('ok.pdf', pdf)), EngineUnavailable);
  });

  it('서명 URL 이 Object Storage 밖(메타데이터 주소·다른 호스트)을 가리키면 내려받지 않고 검사 오류 — SSRF (T-M5-07)', async () => {
    const pdf = Buffer.from('%PDF-1.7');
    for (const url of ['http://169.254.169.254/latest/meta-data/iam/', 'http://internal-admin.local:8080/', 'file:///etc/passwd']) {
      const r = await engine().scan({ ...target('ok.pdf', pdf), downloadUrl: url });
      assert.deepEqual(r, { verdict: 'ERROR', signature: 'DOWNLOAD_URL_NOT_ALLOWED' }, url);
    }
    assert.ok(EgressDenied);
  });

  it('다운로드 URL 이 없으면(옛 접수 API) 판정하지 않는다', async () => {
    const pdf = Buffer.from('%PDF');
    const { downloadUrl: _omit, ...noUrl } = target('x.pdf', pdf);
    await assert.rejects(engine().scan(noUrl), EngineUnavailable);
  });
});

describe('clamd 응답 해석', () => {
  it('OK · FOUND · ERROR', () => {
    assert.deepEqual(parseReply('stream: OK'), { verdict: 'CLEAN' });
    assert.deepEqual(parseReply('stream: Win.Test.EICAR_HDB-1 FOUND'), { verdict: 'MALICIOUS', signature: 'Win.Test.EICAR_HDB-1' });
    assert.equal(parseReply('INSTREAM size limit exceeded. ERROR').verdict, 'ERROR');
    assert.equal(parseReply('').verdict, 'ERROR');
  });
});
