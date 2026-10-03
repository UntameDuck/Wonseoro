import type { FastifyRequest } from 'fastify';
import { Ownership } from '../../common/identity/ownership.service';
import { DocumentService } from './document.service';
interface IntentBody {
    documentType?: string;
    filename?: string;
    mediaType?: string;
    sizeBytes?: number;
}
interface CompleteBody {
    sha256?: string;
    sizeBytes?: number;
}
/**
 * 서류 API — canonical: k-admission-openapi.yaml
 *   createUploadIntent / completeUpload / deleteDocument
 *
 * 파일 자체는 이 서버를 지나가지 않는다. 브라우저가 Object Storage 로 직접 올린다.
 */
export declare class DocumentController {
    private readonly documents;
    private readonly ownership;
    constructor(documents: DocumentService, ownership: Ownership);
    createIntent(applicationId: string, body: IntentBody, req: FastifyRequest): Promise<{
        documentId: string;
    } & import("./object-storage").PresignedUpload>;
    complete(documentId: string, body: CompleteBody, req: FastifyRequest): Promise<{
        id: string;
        status: "REJECTED" | "UPLOADING" | "QUARANTINED" | "AVAILABLE" | "DELETED";
        filename: string;
        mediaType: string;
        sizeBytes: number;
    }>;
    remove(documentId: string, req: FastifyRequest): Promise<void>;
    private required;
    private context;
}
export {};
