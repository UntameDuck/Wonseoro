import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { envBool, secretOrDev } from '@wonseoro/server-kit';
import { S3 } from '../../config';

/** Presigned URL 유효시간. 짧게 둔다. (v1.0 §7.1 단기 Signed URL) */
export const UPLOAD_URL_TTL_SECONDS = 600;
export const DOWNLOAD_URL_TTL_SECONDS = 60;

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
@Injectable()
export class ObjectStorage implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    // 버킷 이름에 대학을 박아두지 않는다. 대학마다 다른 값이고, 기본값이 있으면
    // 설정을 빠뜨린 배포가 남의 대학 버킷 이름으로 뜬다.
    this.bucket = S3.bucket;
    this.client = new S3Client({
      region: S3.region,
      endpoint: S3.endpoint,
      // MinIO 는 path-style 을 쓴다. 운영 CSP 는 대개 virtual-host 다. (v1.1 §A8)
      forcePathStyle: envBool('S3_FORCE_PATH_STYLE', true),
      credentials: {
        // 운영에서 이 값이 없으면 기동하지 않는다.
        // 기본 자격증명이 소스에 있으면 그건 자격증명이 아니다.
        accessKeyId: secretOrDev('S3_ACCESS_KEY', 'wonseoro', 'Object Storage 접근키'),
        secretAccessKey: secretOrDev('S3_SECRET_KEY', 'wonseoro123', 'Object Storage 비밀키'),
      },
    });
  }

  /**
   * 개발 환경에서만 버킷을 만든다.
   * 운영 버킷은 IaC 로 만들고 Public Access 차단·수명주기·암호화를 함께 설정한다.
   * 애플리케이션에 버킷 생성 권한을 주면 최소권한 원칙에 어긋난다. (v1.0 §8.2)
   */
  async onModuleInit(): Promise<void> {
    if (!S3.autoCreateBucket) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`dev bucket created: ${this.bucket}`);
      } catch (err) {
        this.logger.warn(`bucket create failed: ${(err as Error).name}`);
      }
    }
  }

  async presignUpload(objectKey: string, mediaType: string): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: mediaType,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return {
      uploadUrl: url,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      // 이 헤더로 올리지 않으면 서명이 맞지 않아 거부된다.
      requiredHeaders: { 'content-type': mediaType },
    };
  }

  async presignDownload(objectKey: string, filename: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  /** 실제 올라온 크기. 사용자가 선언한 값을 믿지 않는다. */
  async sizeOf(objectKey: string): Promise<number | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return res.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  /** magic-byte 검사에 필요한 앞부분만 읽는다. 전체를 서버로 내려받지 않는다. */
  async readHead(objectKey: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * 전체를 읽어 해시를 계산한다.
   * 파일 크기 상한이 있으므로 허용 범위 안에서만 호출된다.
   */
  async readAll(objectKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(objectKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
    } catch (err) {
      // 삭제 실패가 사용자 요청을 막지 않게 한다. DB 상태가 원장이다.
      this.logger.warn(`object delete failed: ${(err as Error).name}`);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '__probe__' }));
      return true;
    } catch (err) {
      // 404 는 정상이다. 연결 자체가 안 되는 경우만 실패로 본다.
      const name = (err as { name?: string }).name ?? '';
      return name === 'NotFound' || name === 'NoSuchKey';
    }
  }
}
