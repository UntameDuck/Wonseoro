// 실 ClamAV 판정 — clamd·공식 서명 DB 로 (T-M5-08, docs/13 단계 6, D-58)
//
// 사용: docker compose -f infra/compose/docker-compose.dev.yml --profile av up -d clamav   (처음엔 서명 DB 를 받느라 몇 분)
//       npm run build -w @wonseoro/server-kit -w @wonseoro/document-service && npm run test:security:clamd
//   다른 clamd: CLAMD_HOST·CLAMD_PORT
// 서류 워커의 실제 엔진(ClamAvEngine — 서명 URL 로 받아 INSTREAM)으로 판정한다. 저장소는 이 시험이 띄우는 로컬 HTTP 서버다.
// 결과는 tests/security/results/clamd-live-<시각>.json
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { configureEgress } = await import(new URL('../../packages/server-kit/dist/index.js', import.meta.url).href);
const { ClamAvEngine } = await import(new URL('../../apps/document-service/dist/engines.js', import.meta.url).href);
const HOST = process.env.CLAMD_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CLAMD_PORT ?? 3310);
const MB = 1024 * 1024;

const started = Date.now();
const steps = [];
const problems = [];
const check = (ok, what, detail) => {
  steps.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✘'} ${what}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!ok) problems.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 최소 zip — 항목마다 deflate. zipBomb 은 0 바이트를 길게 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const body = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** 최소 PDF — 본문 스트림 하나(FlateDecode 면 압축해 넣는다) */
function pdf({ stream = Buffer.from('BT /F1 12 Tf (scan) Tj ET'), flate = false, extra = '' } = {}) {
  const data = flate ? zlib.deflateSync(stream, { level: 9 }) : stream;
  const parts = [
    '%PDF-1.7\n',
    `1 0 obj << /Type /Catalog /Pages 2 0 R ${extra} >> endobj\n`,
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >> endobj\n',
    `4 0 obj << /Length ${data.length}${flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
  ];
  return Buffer.concat([Buffer.from(parts.join(''), 'latin1'), data, Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
}

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const files = new Map();
const storage = createServer((req, res) => {
  const body = files.get(req.url.slice(1));
  if (!body) return res.writeHead(404).end();
  res.writeHead(200, { 'content-length': body.length }).end(body);
});

let server = null;
try {
  // clamd 가 서명 DB 를 다 받고 뜰 때까지(처음엔 몇 분)
  let pong = false;
  for (let i = 0; i < 120 && !pong; i++) {
    pong = await new Promise((resolve) => {
      const s = connect({ host: HOST, port: PORT }, () => s.write('zPING\0'));
      s.setTimeout(3000, () => { s.destroy(); resolve(false); });
      s.on('data', (d) => { s.destroy(); resolve(d.toString().startsWith('PONG')); });
      s.on('error', () => resolve(false));
    });
    if (!pong) await sleep(5_000);
  }
  check(pong, 'clamd 가 응답한다(PING → PONG)');

  server = await new Promise((r) => { const s = storage.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  configureEgress([base]);
  const engine = new ClamAvEngine(HOST, PORT, 120_000);
  const version = await engine.version();
  check(/^ClamAV 1\.4\.\d+\/\d+\//.test(version), '엔진·서명 DB 버전 — 증적에 남는다', { version });

  const scan = async (name, body, mediaType = 'application/pdf') => {
    files.set(name, body);
    return engine.scan({
      documentId: name, objectKey: name, mediaType, sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'), downloadUrl: `${base}/${name}`,
    });
  };
  const cases = [
    ['깨끗한 PDF', 'clean.pdf', pdf(), (r) => r.verdict === 'CLEAN'],
    ['EICAR — 실제 서명 DB 로 MALICIOUS', 'eicar.pdf', EICAR, (r) => r.verdict === 'MALICIOUS' && /eicar/i.test(r.signature)],
    ['압축 안의 EICAR', 'eicar-in.zip', zip([['readme.txt', EICAR]]), (r) => r.verdict === 'MALICIOUS' && /eicar/i.test(r.signature)],
    // ClamAV 1.4 는 큰 항목 하나뿐인 압축은 경보 없이 넘긴다(실측) — 여러 항목으로 총량 한도(MaxScanSize)를 넘는 폭탄은 잡는다.
    // 서류는 압축 형식을 받지 않는다(형식 검사 거절) — 압축 폭탄이 들어올 길은 PDF 안뿐이고, 아래 두 판정이 막는다
    ['Zip Bomb(압축 120KB → 풀면 120MB, 항목 4개) — 총량 한도 초과 경보', 'bomb.zip', zip(['a', 'b', 'c', 'd'].map((n) => [`${n}.bin`, Buffer.alloc(30 * MB)])), (r) => r.verdict === 'MALICIOUS' && /Limits\.Exceeded/i.test(r.signature)],
    ['PDF 에 첨부한 압축 파일 — 첨부 파일이 든 PDF 는 받지 않는다', 'attached.pdf', pdf({ extra: '/Names << /EmbeddedFiles << /Names [(a.zip) << /Type /Filespec /EF << /F 5 0 R >> >>] >> >>' }), (r) => r.verdict === 'MALICIOUS' && /EmbeddedFile|Heuristics/.test(r.signature)],
    ['PDF 폭탄(본문 스트림이 풀면 80MB) — 한도 초과 경보', 'bomb.pdf', pdf({ stream: Buffer.alloc(80 * MB), flate: true }), (r) => r.verdict === 'MALICIOUS' && /Limits\.Exceeded|Heuristics/i.test(r.signature)],
    ['자바스크립트로 움직이는 PDF', 'active.pdf', pdf({ extra: '/OpenAction << /S /JavaScript /JS (app.launchURL("http://x")) >>' }), (r) => r.verdict === 'MALICIOUS'],
    ['한도(30MB)를 넘는 파일 — 검사하지 못했으니 통과시키지 않는다', 'huge.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(31 * MB, 0x41)]), (r) => r.verdict === 'ERROR'],
  ];
  for (const [what, name, body, ok] of cases) {
    const r = await scan(name, body).catch((e) => ({ verdict: 'THREW', signature: e.message }));
    check(ok(r), what, { bytes: body.length, ...r });
  }
} catch (err) {
  check(false, `중단: ${err.message}`);
} finally {
  server?.close();
}

const result = {
  test: '실 ClamAV 판정 (T-M5-08)',
  environment: '축소 환경 — 로컬 clamd(clamav/clamav 1.4, 공식 서명 DB), infra/clamav/clamd.conf',
  at: new Date(started).toISOString(),
  passed: problems.length === 0,
  steps,
};
const dir = path.join(ROOT, 'tests/security/results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `clamd-live-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.passed ? '✔' : '✘'} 실 ClamAV ${steps.length}개 — 문제 ${problems.length}건 → ${path.relative(ROOT, file)}`);
process.exit(result.passed ? 0 : 1);
