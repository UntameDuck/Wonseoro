"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ObjectStorage_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectStorage = exports.DOWNLOAD_URL_TTL_SECONDS = exports.UPLOAD_URL_TTL_SECONDS = void 0;
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
/** Presigned URL 유효시간. 짧게 둔다. (v1.0 §7.1 단기 Signed URL) */
exports.UPLOAD_URL_TTL_SECONDS = 600;
exports.DOWNLOAD_URL_TTL_SECONDS = 60;
/**
 * S3 호환 Object Storage.
 *
 * **파일은 API 서버를 경유하지 않는다.** 브라우저 → Object Storage 직접 업로드다.
 * 마감 피크에 서류 트래픽이 접수 API 의 CPU·메모리를 먹으면 안 된다. (v1.1 §B5)
 *
 * Bucket 은 Public Access 를 차단한다. 접근은 전부 단기 Signed URL 로만. (v1.0 §8.1)
 */
let ObjectStorage = ObjectStorage_1 = class ObjectStorage {
    logger = new common_1.Logger(ObjectStorage_1.name);
    client;
    bucket;
    constructor() {
        // 버킷 이름에 대학을 박아두지 않는다. 대학마다 다른 값이고, 기본값이 있으면
        // 설정을 빠뜨린 배포가 남의 대학 버킷 이름으로 뜬다.
        this.bucket = config_1.S3.bucket;
        this.client = new client_s3_1.S3Client({
            region: config_1.S3.region,
            endpoint: config_1.S3.endpoint,
            // MinIO 는 path-style 을 쓴다. 운영 CSP 는 대개 virtual-host 다. (v1.1 §A8)
            forcePathStyle: (0, server_kit_1.envBool)('S3_FORCE_PATH_STYLE', true),
            credentials: {
                // 운영에서 이 값이 없으면 기동하지 않는다.
                // 기본 자격증명이 소스에 있으면 그건 자격증명이 아니다.
                accessKeyId: (0, server_kit_1.secretOrDev)('S3_ACCESS_KEY', 'wonseoro', 'Object Storage 접근키'),
                secretAccessKey: (0, server_kit_1.secretOrDev)('S3_SECRET_KEY', 'wonseoro123', 'Object Storage 비밀키'),
            },
        });
    }
    /**
     * 개발 환경에서만 버킷을 만든다.
     * 운영 버킷은 IaC 로 만들고 Public Access 차단·수명주기·암호화를 함께 설정한다.
     * 애플리케이션에 버킷 생성 권한을 주면 최소권한 원칙에 어긋난다. (v1.0 §8.2)
     */
    async onModuleInit() {
        if (!config_1.S3.autoCreateBucket)
            return;
        try {
            await this.client.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucket }));
        }
        catch {
            try {
                await this.client.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucket }));
                this.logger.log(`dev bucket created: ${this.bucket}`);
            }
            catch (err) {
                this.logger.warn(`bucket create failed: ${err.name}`);
            }
        }
    }
    async presignUpload(objectKey, mediaType) {
        const url = await (0, s3_request_presigner_1.getSignedUrl)(this.client, new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            ContentType: mediaType,
        }), { expiresIn: exports.UPLOAD_URL_TTL_SECONDS });
        return {
            uploadUrl: url,
            expiresAt: new Date(Date.now() + exports.UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
            // 이 헤더로 올리지 않으면 서명이 맞지 않아 거부된다.
            requiredHeaders: { 'content-type': mediaType },
        };
    }
    async presignDownload(objectKey, filename) {
        return (0, s3_request_presigner_1.getSignedUrl)(this.client, new client_s3_1.GetObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
        }), { expiresIn: exports.DOWNLOAD_URL_TTL_SECONDS });
    }
    /** 실제 올라온 크기. 사용자가 선언한 값을 믿지 않는다. */
    async sizeOf(objectKey) {
        try {
            const res = await this.client.send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
            return res.ContentLength ?? null;
        }
        catch {
            return null;
        }
    }
    /** magic-byte 검사에 필요한 앞부분만 읽는다. 전체를 서버로 내려받지 않는다. */
    async readHead(objectKey, bytes) {
        const res = await this.client.send(new client_s3_1.GetObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            Range: `bytes=0-${bytes - 1}`,
        }));
        const chunks = [];
        for await (const chunk of res.Body) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }
    /**
     * 전체를 읽어 해시를 계산한다.
     * 파일 크기 상한이 있으므로 허용 범위 안에서만 호출된다.
     */
    async readAll(objectKey) {
        const res = await this.client.send(new client_s3_1.GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
        const chunks = [];
        for await (const chunk of res.Body) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }
    async remove(objectKey) {
        try {
            await this.client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
        }
        catch (err) {
            // 삭제 실패가 사용자 요청을 막지 않게 한다. DB 상태가 원장이다.
            this.logger.warn(`object delete failed: ${err.name}`);
        }
    }
    async healthy() {
        try {
            await this.client.send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket, Key: '__probe__' }));
            return true;
        }
        catch (err) {
            // 404 는 정상이다. 연결 자체가 안 되는 경우만 실패로 본다.
            const name = err.name ?? '';
            return name === 'NotFound' || name === 'NoSuchKey';
        }
    }
};
exports.ObjectStorage = ObjectStorage;
exports.ObjectStorage = ObjectStorage = ObjectStorage_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ObjectStorage);
//# sourceMappingURL=object-storage.js.map