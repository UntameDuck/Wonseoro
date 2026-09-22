import { Injectable } from '@nestjs/common';
import { ProblemException } from '../../common/problem/problem.exception';

/**
 * 파일 검사 — 기술설계서 v1.0 §5.4, v1.1 §B5, §09
 *
 * 원칙
 *   1. **브라우저가 보낸 MIME 을 신뢰하지 않는다.** magic-byte 로 판정한다.
 *   2. 확장자·MIME·실제 내용이 셋 다 일치해야 통과한다.
 *   3. 실행파일·매크로·압축파일은 아예 받지 않는다. (§09 고위험 Abuse Case)
 *   4. 크기 상한을 먼저 본다. Zip Bomb 은 받지 않는 것이 가장 싸다.
 */

export interface AllowedType {
  mediaType: string;
  extensions: readonly string[];
  /** 파일 앞부분에서 확인할 시그니처. 하나라도 맞으면 통과. */
  signatures: readonly (readonly number[])[];
  maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * 허용 목록 방식이다. 차단 목록으로 하면 새 위험 포맷이 나올 때마다 뚫린다.
 * 대학이 다른 포맷을 요구하면 Config 로 넓히는 것이 아니라 여기를 검토해야 한다.
 */
export const ALLOWED_TYPES: readonly AllowedType[] = [
  {
    mediaType: 'application/pdf',
    extensions: ['.pdf'],
    signatures: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    maxBytes: 10 * MB,
  },
  {
    mediaType: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    signatures: [[0xff, 0xd8, 0xff]],
    maxBytes: 5 * MB,
  },
  {
    mediaType: 'image/png',
    extensions: ['.png'],
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    maxBytes: 5 * MB,
  },
];

/**
 * 명시적으로 거부하는 시그니처.
 * 허용 목록에 없으면 어차피 막히지만, 거부 사유를 정확히 알려주기 위해 둔다.
 */
const DANGEROUS: ReadonlyArray<{ name: string; signature: readonly number[] }> = [
  { name: '실행파일(PE)', signature: [0x4d, 0x5a] }, // MZ
  { name: '실행파일(ELF)', signature: [0x7f, 0x45, 0x4c, 0x46] },
  { name: '실행파일(Mach-O)', signature: [0xfe, 0xed, 0xfa, 0xce] },
  // ZIP 계열. docx/xlsx/한글 문서와 매크로·Zip Bomb 이 전부 여기 들어간다.
  { name: '압축파일', signature: [0x50, 0x4b, 0x03, 0x04] },
  { name: '압축파일(RAR)', signature: [0x52, 0x61, 0x72, 0x21] },
  { name: '스크립트(shebang)', signature: [0x23, 0x21] }, // #!
];

export interface InspectInput {
  filename: string;
  declaredMediaType: string;
  sizeBytes: number;
}

@Injectable()
export class FileInspector {
  /**
   * 업로드 **전** 검사. Presigned URL 을 내주기 전에 거른다.
   * 여기서 막으면 Object Storage 에 쓰레기가 올라가지 않는다.
   */
  precheck(input: InspectInput): AllowedType {
    const ext = this.extensionOf(input.filename);
    const allowed = ALLOWED_TYPES.find((t) => t.mediaType === input.declaredMediaType);

    if (!allowed) {
      throw ProblemException.validationFailed(
        `허용되지 않는 형식입니다. 가능한 형식: ${ALLOWED_TYPES.map((t) => t.extensions[0]).join(', ')}`,
      );
    }
    if (!allowed.extensions.includes(ext)) {
      throw ProblemException.validationFailed(
        `파일 확장자(${ext})가 형식(${input.declaredMediaType})과 맞지 않습니다.`,
      );
    }
    if (input.sizeBytes <= 0) {
      throw ProblemException.validationFailed('빈 파일은 업로드할 수 없습니다.');
    }
    if (input.sizeBytes > allowed.maxBytes) {
      throw ProblemException.validationFailed(
        `파일이 너무 큽니다. 최대 ${Math.floor(allowed.maxBytes / MB)}MB 까지 가능합니다.`,
      );
    }
    return allowed;
  }

  /**
   * 업로드 **후** 검사. 실제 바이트를 본다.
   * 사용자가 Presigned URL 로 전혀 다른 파일을 올렸을 수 있다.
   */
  verifyContent(head: Buffer, expected: AllowedType): void {
    const dangerous = DANGEROUS.find((d) => this.startsWith(head, d.signature));
    if (dangerous) {
      throw ProblemException.validationFailed(
        `${dangerous.name} 은(는) 업로드할 수 없습니다.`,
      );
    }

    const matches = expected.signatures.some((sig) => this.startsWith(head, sig));
    if (!matches) {
      // 선언한 형식과 실제 내용이 다르다. 확장자만 바꿔 올린 경우가 여기 걸린다.
      throw ProblemException.validationFailed(
        `파일 내용이 ${expected.mediaType} 형식이 아닙니다.`,
      );
    }
  }

  /** 검사에 필요한 앞부분 바이트 수. 전체를 읽지 않는다. */
  static readonly HEAD_BYTES = 16;

  private startsWith(buf: Buffer, signature: readonly number[]): boolean {
    if (buf.length < signature.length) return false;
    return signature.every((b, i) => buf[i] === b);
  }

  private extensionOf(filename: string): string {
    const idx = filename.lastIndexOf('.');
    if (idx < 0) return '';
    return filename.slice(idx).toLowerCase();
  }
}
