import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_TYPES, FileInspector } from './file-inspector';

const inspector = new FileInspector();
const pdf = ALLOWED_TYPES.find((t) => t.mediaType === 'application/pdf')!;

const status = (fn: () => unknown): number | undefined => {
  try {
    fn();
    return undefined;
  } catch (err) {
    return (err as { problem?: { status: number } }).problem?.status;
  }
};

describe('업로드 전 검사 (v1.1 §B5)', () => {
  it('허용 형식·확장자·크기가 맞으면 통과한다', () => {
    assert.doesNotThrow(() =>
      inspector.precheck({
        filename: '생활기록부.pdf',
        declaredMediaType: 'application/pdf',
        sizeBytes: 1024,
      }),
    );
  });

  it('허용 목록에 없는 형식은 거부한다 — 차단 목록이 아니라 허용 목록이다', () => {
    assert.equal(
      status(() =>
        inspector.precheck({
          filename: 'a.exe',
          declaredMediaType: 'application/x-msdownload',
          sizeBytes: 100,
        }),
      ),
      400,
    );
  });

  it('확장자와 MIME 이 어긋나면 거부한다', () => {
    assert.equal(
      status(() =>
        inspector.precheck({
          filename: 'a.png',
          declaredMediaType: 'application/pdf',
          sizeBytes: 100,
        }),
      ),
      400,
    );
  });

  it('빈 파일을 거부한다', () => {
    assert.equal(
      status(() =>
        inspector.precheck({
          filename: 'a.pdf',
          declaredMediaType: 'application/pdf',
          sizeBytes: 0,
        }),
      ),
      400,
    );
  });

  it('크기 상한을 넘으면 거부한다 — Zip Bomb 은 받지 않는 것이 가장 싸다', () => {
    assert.equal(
      status(() =>
        inspector.precheck({
          filename: 'a.pdf',
          declaredMediaType: 'application/pdf',
          sizeBytes: pdf.maxBytes + 1,
        }),
      ),
      400,
    );
  });

  it('확장자 대소문자를 가리지 않는다', () => {
    assert.doesNotThrow(() =>
      inspector.precheck({
        filename: 'SCAN.PDF',
        declaredMediaType: 'application/pdf',
        sizeBytes: 100,
      }),
    );
  });
});

describe('업로드 후 내용 검사 — 브라우저 MIME 을 신뢰하지 않는다 (v1.0 §5.4)', () => {
  it('실제 PDF 는 통과한다', () => {
    const head = Buffer.from('%PDF-1.7\n', 'ascii');
    assert.doesNotThrow(() => inspector.verifyContent(head, pdf));
  });

  it('확장자만 pdf 인 실행파일을 잡아낸다 (§09 고위험 Abuse Case)', () => {
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    assert.equal(status(() => inspector.verifyContent(mz, pdf)), 400);
  });

  it('ELF 실행파일을 잡아낸다', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    assert.equal(status(() => inspector.verifyContent(elf, pdf)), 400);
  });

  it('압축파일을 거부한다 — 매크로·Zip Bomb 이 전부 여기 들어간다', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    assert.equal(status(() => inspector.verifyContent(zip, pdf)), 400);
  });

  it('스크립트(shebang)를 거부한다', () => {
    const sh = Buffer.from('#!/bin/sh\n', 'ascii');
    assert.equal(status(() => inspector.verifyContent(sh, pdf)), 400);
  });

  it('위험 시그니처는 아니지만 형식이 다른 파일도 거부한다', () => {
    const text = Buffer.from('그냥 텍스트 파일입니다', 'utf8');
    assert.equal(status(() => inspector.verifyContent(text, pdf)), 400);
  });

  it('내용이 시그니처보다 짧아도 안전하게 거부한다', () => {
    assert.equal(status(() => inspector.verifyContent(Buffer.from([0x25]), pdf)), 400);
  });
});
