import { EgressDenied, egressHttp } from '@wonseoro/server-kit';
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
      // 서명 URL 은 남(접수 API)이 만든 주소다 — 출구 허용 목록(Object Storage 호스트만, 메타데이터 주소 거절)을 거친다 (T-M5-07)
      res = await egressHttp().fetch(target.downloadUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      // 허용되지 않은 주소를 가리키는 서명 URL — 장애가 아니라 의심스러운 입력이다. 다시 시도하지 않고 검사 오류로 남겨 사람이 본다
      if (err instanceof EgressDenied || (err as { cause?: unknown }).cause instanceof EgressDenied) {
        return { verdict: 'ERROR', signature: 'DOWNLOAD_URL_NOT_ALLOWED' };
      }
      throw new EngineUnavailable(`저장소에 닿지 못했다: ${(err as Error).message}`);
    }
    // 파일이 없다 — 검사할 수 없는 서류다. 서명이 만료됐거나(403) 저장소가 아프면(5xx) 다음 주기에 새 URL 로.
    if (res.status === 404) return { verdict: 'ERROR', signature: 'OBJECT_NOT_FOUND' };
    if (!res.ok || !res.body) throw new EngineUnavailable(`저장소 응답 ${res.status}`);

    const socket = await this.open();
    try {
      // 응답을 먼저 기다리기 시작한다 — clamd 는 한도를 넘으면 다 받기 전에 답하고 연결을 닫는다(실 clamd 에서 확인).
      // 그때 계속 쓰면 drain 을 영원히 기다린다
      const replied = this.reply(socket);
      let early: string | null = null;
      replied.then((a) => (early = a), () => undefined);
      socket.write('zINSTREAM\0');
      const hash = createHash('sha256');
      const active = target.mediaType === 'application/pdf' ? new PdfActiveContent() : null;
      let size = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (early !== null) break;
          hash.update(chunk);
          active?.feed(chunk);
          size += chunk.length;
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          await write(socket, header);
          await write(socket, Buffer.from(chunk));
        }
        if (early === null) await write(socket, Buffer.alloc(4)); // 끝
      } catch (err) {
        // 쓰다가 연결이 닫혔다 — clamd 가 먼저 답했으면 그 답(한도 초과 등)을 쓴다
        const answer = await replied.catch(() => null);
        if (answer === null) throw err;
        return incomplete(parseReply(answer));
      }
      const answer = await replied;
      // 다 보내기 전에 답이 왔다 — 끝까지 검사하지 못한 파일이다(통과시키지 않는다)
      if (size !== target.sizeBytes && early !== null) return incomplete(parseReply(answer));

      if (hash.digest('hex') !== target.sha256.toLowerCase() || size !== target.sizeBytes) {
        return { verdict: 'ERROR', signature: 'CONTENT_MISMATCH' };
      }
      const verdict = parseReply(answer);
      // clamd 가 깨끗하다고 해도 스스로 움직이는 PDF(자바스크립트·실행·첨부 파일)는 받지 않는다 — 서류에 필요 없는 기능이다
      const found = active?.found();
      if (verdict.verdict === 'CLEAN' && found?.length) return { verdict: 'MALICIOUS', signature: `Wonseoro.PDF.ActiveContent.${found.join('+')}` };
      return verdict;
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
      // 오류는 닫힘 앞에 온다 — 쓰기 오류(clamd 가 한도로 먼저 끊음)가 이미 받은 답을 덮지 않게 닫힐 때 판단한다
      let failure: Error | null = null;
      socket.on('error', (err) => (failure ??= err));
      socket.once('close', () => {
        if (!buf.includes('\0')) reject(new EngineUnavailable(`clamd 가 응답 없이 연결을 닫았다${failure ? `: ${failure.message}` : ''}`));
      });
    });
  }
}

/**
 * PDF 능동 콘텐츠 — 자바스크립트(/JavaScript·/JS)·외부 실행(/Launch)·첨부 파일(/EmbeddedFile·/EmbeddedFiles·/EF)·멀티미디어(/RichMedia)·XFA 양식.
 * 입학 서류(성적 증명·추천서 스캔)에 필요 없는 기능이고, 매크로 문서와 같은 길(열면 실행)이다 — T-M5-08 "매크로 차단".
 * Office 매크로 문서는 형식 허용 목록(PDF·JPG·PNG)과 magic-byte 검사가 먼저 막는다(접수 API file-inspector).
 * 이름의 #xx 표기(/J#61vaScript)를 풀어 본다. 압축된 객체 스트림 안의 이름은 clamd 의 PDF 해석에 맡긴다.
 */
export class PdfActiveContent {
  private static readonly NAMES = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'EF', 'RichMedia', 'XFA']);
  private tail = '';
  private readonly hits = new Set<string>();

  feed(chunk: Uint8Array): void {
    const text = this.tail + Buffer.from(chunk).toString('latin1');
    for (const m of text.matchAll(/\/((?:[A-Za-z0-9]|#[0-9A-Fa-f]{2}){1,40})(?=[\s/()<>[\]{}%])/g)) {
      const name = (m[1] as string).replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      if (PdfActiveContent.NAMES.has(name)) this.hits.add(name);
    }
    this.tail = text.slice(-128); // 조각 경계에 걸린 이름
  }

  found(): string[] {
    return [...this.hits].sort();
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

/** 끝까지 보내지 못한 검사 — "깨끗함" 은 믿지 않는다 */
function incomplete(r: EngineResult): EngineResult {
  return r.verdict === 'CLEAN' ? { verdict: 'ERROR', signature: 'INCOMPLETE_SCAN' } : r;
}

function write(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) return reject(new EngineUnavailable('clamd 가 연결을 닫았다'));
    const ok = socket.write(data, (err) => (err ? reject(new EngineUnavailable(err.message)) : undefined));
    if (ok) return resolve();
    // 쓰기 버퍼가 찼다 — 비워지거나, 연결이 닫히거나(clamd 가 먼저 답하고 끊음) 둘 중 하나를 기다린다
    const onDrain = () => {
      socket.off('close', onClose);
      resolve();
    };
    const onClose = () => {
      socket.off('drain', onDrain);
      reject(new EngineUnavailable('clamd 가 연결을 닫았다'));
    };
    socket.once('drain', onDrain);
    socket.once('close', onClose);
  });
}
