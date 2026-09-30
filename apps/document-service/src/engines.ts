import { createHash } from 'node:crypto';
import { connect, Socket } from 'node:net';

/** 검사 대상 — 접수 API 의 검사 대기 목록 한 건. */
export interface ScanTarget {
  documentId: string;
  objectKey: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  /** 이 파일 하나만 몇 분 동안 읽을 수 있는 서명된 URL (D-58). 워커는 저장소 자격증명이 없다. */
  downloadUrl?: string;
}

export type ScanVerdict = 'CLEAN' | 'MALICIOUS' | 'ERROR';

export interface EngineResult {
  verdict: ScanVerdict;
  /** MALICIOUS 면 엔진이 찾은 것의 이름. ERROR 면 까닭. 파일 내용·개인정보는 담지 않는다. */
  signature?: string;
}

/**
 * 엔진에 닿지 못했다(연결 거부·시간 초과·저장소 일시 장애). **판정이 아니다.**
 * 이 서류는 보고하지 않고 검사 대기(QUARANTINED)로 남겨 다음 주기에 다시 가져온다 —
 * 엔진이 잠깐 죽었다고 지원자 서류를 "검사 실패" 로 떨어뜨리면 다시 올려야 한다.
 */
export class EngineUnavailable extends Error {}

export interface ScanEngine {
  /** 증적에 남는 엔진 이름 (document_scan.scanner) */
  readonly name: string;
  /** 증적에 남는 엔진·서명 DB 버전 (document_scan.engine_version) */
  version(): Promise<string>;
  scan(target: ScanTarget): Promise<EngineResult>;
}

/**
 * 흉내 엔진 — **개발 전용.** 파일을 읽지 않고 표식(objectKey 의 malicious·scanerror)과 크기로 판정한다.
 * 운영에서 이것이 골라지면 기동하지 않는다(R8). 실제 엔진처럼 시간이 걸리게 해 화면의 "검사 중" 을 보인다.
 */
export class MockEngine implements ScanEngine {
  readonly name = 'mock-av';

  constructor(
    private readonly delayMs: number,
    private readonly declaredVersion: string,
  ) {}

  async version(): Promise<string> {
    return this.declaredVersion;
  }

  async scan(target: ScanTarget): Promise<EngineResult> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (target.objectKey.includes('malicious')) return { verdict: 'MALICIOUS', signature: 'Mock.Marker' };
    if (target.objectKey.includes('scanerror')) return { verdict: 'ERROR', signature: 'Mock.ScanError' };
    // 크기가 0이면 검사할 것이 없다. 통과시키지 않는다.
    if (target.sizeBytes <= 0) return { verdict: 'ERROR', signature: 'EMPTY_FILE' };
    return { verdict: 'CLEAN' };
  }
}

/**
 * ClamAV 엔진 — clamd 의 INSTREAM 프로토콜 (T-M5-08, D-58)
 *
 *   워커 ─GET(서명 URL)→ Object Storage     파일을 받아
 *   워커 ─zINSTREAM→ clamd                  [4바이트 길이 + 조각]… [0000] 으로 흘려보내고
 *   clamd → "stream: OK" | "stream: <이름> FOUND" | "... ERROR"
 *
 * 흘려보내는 동안 SHA-256 을 계산해 접수 API 가 기록한 해시와 맞춘다 — 검사한 바이트가
 * 기록된 파일과 다르면(저장소에서 바뀌었으면) 검사 결과를 그 파일에 붙일 수 없다.
 * 파일 전체를 메모리에 올리지 않는다.
 */
export class ClamAvEngine implements ScanEngine {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  /** 예: "ClamAV 1.4.1/27411/Mon Sep 29 09:32:58 2026" — 엔진 버전/서명 DB 버전/서명 DB 날짜 */
  async version(): Promise<string> {
    const socket = await this.open();
    try {
      socket.write('zVERSION\0');
      return (await this.reply(socket)).slice(0, 64);
    } finally {
      socket.destroy();
    }
  }

  async scan(target: ScanTarget): Promise<EngineResult> {
    if (!target.downloadUrl) throw new EngineUnavailable('다운로드 URL 이 없다 — 접수 API 가 옛 버전이다');

    let res: Response;
    try {
      res = await fetch(target.downloadUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new EngineUnavailable(`저장소에 닿지 못했다: ${(err as Error).message}`);
    }
    // 파일이 없다 — 검사할 수 없는 서류다. 서명이 만료됐거나(403) 저장소가 아프면(5xx) 다음 주기에 새 URL 로.
    if (res.status === 404) return { verdict: 'ERROR', signature: 'OBJECT_NOT_FOUND' };
    if (!res.ok || !res.body) throw new EngineUnavailable(`저장소 응답 ${res.status}`);

    const socket = await this.open();
    try {
      socket.write('zINSTREAM\0');
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        size += chunk.length;
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        await write(socket, header);
        await write(socket, Buffer.from(chunk));
      }
      await write(socket, Buffer.alloc(4)); // 끝
      const answer = await this.reply(socket);

      if (hash.digest('hex') !== target.sha256.toLowerCase() || size !== target.sizeBytes) {
        return { verdict: 'ERROR', signature: 'CONTENT_MISMATCH' };
      }
      return parseReply(answer);
    } finally {
      socket.destroy();
    }
  }

  private open(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('clamd 시간 초과')));
      socket.once('connect', () => resolve(socket));
      socket.once('error', (err) => reject(new EngineUnavailable(`clamd 에 닿지 못했다: ${err.message}`)));
    });
  }

  /** z 명령의 응답은 NUL 로 끝난다. */
  private reply(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      let buf = '';
      socket.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        const end = buf.indexOf('\0');
        if (end >= 0) resolve(buf.slice(0, end));
      });
      socket.once('error', (err) => reject(new EngineUnavailable(`clamd 응답 오류: ${err.message}`)));
      socket.once('close', () => {
        if (!buf.includes('\0')) reject(new EngineUnavailable('clamd 가 응답 없이 연결을 닫았다'));
      });
    });
  }
}

/** "stream: OK" · "stream: Eicar-Signature FOUND" · "INSTREAM size limit exceeded. ERROR" */
export function parseReply(answer: string): EngineResult {
  const text = answer.trim();
  if (/^stream: OK$/.test(text)) return { verdict: 'CLEAN' };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found?.[1]) return { verdict: 'MALICIOUS', signature: found[1].slice(0, 200) };
  // 크기 초과·형식 오류 — 검사하지 못한 파일은 통과시키지 않는다
  return { verdict: 'ERROR', signature: text.replace(/\s*ERROR$/, '').slice(0, 200) || 'UNKNOWN' };
}

function write(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = socket.write(data, (err) => (err ? reject(new EngineUnavailable(err.message)) : undefined));
    if (ok) resolve();
    else socket.once('drain', () => resolve());
  });
}
