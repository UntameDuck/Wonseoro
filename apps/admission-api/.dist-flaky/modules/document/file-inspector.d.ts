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
/**
 * 허용 목록 방식이다. 차단 목록으로 하면 새 위험 포맷이 나올 때마다 뚫린다.
 * 대학이 다른 포맷을 요구하면 Config 로 넓히는 것이 아니라 여기를 검토해야 한다.
 * 형식·확장자·크기 상한은 계약 패키지(UPLOAD_FORMATS)에서 온다 — 화면 안내와 같은 값이다 (T-M5-56).
 */
export declare const ALLOWED_TYPES: readonly AllowedType[];
export interface InspectInput {
    filename: string;
    declaredMediaType: string;
    sizeBytes: number;
}
export declare class FileInspector {
    /**
     * 업로드 **전** 검사. Presigned URL 을 내주기 전에 거른다.
     * 여기서 막으면 Object Storage 에 쓰레기가 올라가지 않는다.
     */
    precheck(input: InspectInput): AllowedType;
    /**
     * 업로드 **후** 검사. 실제 바이트를 본다.
     * 사용자가 Presigned URL 로 전혀 다른 파일을 올렸을 수 있다.
     */
    verifyContent(head: Buffer, expected: AllowedType): void;
    /** 검사에 필요한 앞부분 바이트 수. 전체를 읽지 않는다. */
    static readonly HEAD_BYTES = 16;
    private startsWith;
    private extensionOf;
}
