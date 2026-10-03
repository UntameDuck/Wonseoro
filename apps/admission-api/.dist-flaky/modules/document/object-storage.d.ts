import { OnModuleInit } from '@nestjs/common';
/** Presigned URL 유효시간. 짧게 둔다. (v1.0 §7.1 단기 Signed URL) */
export declare const UPLOAD_URL_TTL_SECONDS = 600;
export declare const DOWNLOAD_URL_TTL_SECONDS = 60;
export interface PresignedUpload {
    uploadUrl: string;
    expiresAt: string;
    requiredHeaders: Record<string, string>;
}
/**
 * S3 호환 Object Storage.
 *
 * **파일은 API 서버를 경유하지 않는다.** 브라우저 → Object Storage 직접 업로드다.
 * 마감 피크에 서류 트래픽이 접수 API 의 CPU·메모리를 먹으면 안 된다. (v1.1 §B5)
 *
 * Bucket 은 Public Access 를 차단한다. 접근은 전부 단기 Signed URL 로만. (v1.0 §8.1)
 */
export declare class ObjectStorage implements OnModuleInit {
    private readonly logger;
    private readonly client;
    private readonly bucket;
    constructor();
    /**
     * 개발 환경에서만 버킷을 만든다.
     * 운영 버킷은 IaC 로 만들고 Public Access 차단·수명주기·암호화를 함께 설정한다.
     * 애플리케이션에 버킷 생성 권한을 주면 최소권한 원칙에 어긋난다. (v1.0 §8.2)
     */
    onModuleInit(): Promise<void>;
    presignUpload(objectKey: string, mediaType: string): Promise<PresignedUpload>;
    presignDownload(objectKey: string, filename: string): Promise<string>;
    /** 실제 올라온 크기. 사용자가 선언한 값을 믿지 않는다. */
    sizeOf(objectKey: string): Promise<number | null>;
    /** magic-byte 검사에 필요한 앞부분만 읽는다. 전체를 서버로 내려받지 않는다. */
    readHead(objectKey: string, bytes: number): Promise<Buffer>;
    /**
     * 전체를 읽어 해시를 계산한다.
     * 파일 크기 상한이 있으므로 허용 범위 안에서만 호출된다.
     */
    readAll(objectKey: string): Promise<Buffer>;
    remove(objectKey: string): Promise<void>;
    healthy(): Promise<boolean>;
}
