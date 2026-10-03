import { Db } from '@wonseoro/server-kit';
import { DocumentService } from './document.service';
import { ObjectStorage } from './object-storage';
interface ScanResultBody {
    result?: 'CLEAN' | 'MALICIOUS' | 'ERROR';
    scanner?: string;
    engineVersion?: string;
    /** 엔진이 찾은 것(악성코드 이름 등). 파일 내용·개인정보는 담지 않는다. */
    signature?: string;
}
export declare function parseScanLimit(value?: string): number;
/**
 * AV 검사 워커용 내부 API — 기술설계서 v1.0 §5.4, ADR-0004
 *
 * 계약: OpenAPI listDocumentsPendingScan · reportDocumentScanResult (D-20).
 *
 * `document-service` 가 QUARANTINED 서류를 가져가 검사하고 결과를 돌려준다.
 * 운영에서는 mTLS 로만 접근하며 외부에 노출하지 않는다. (M5 T-M5-05)
 */
export declare class DocumentScanController {
    private readonly documents;
    private readonly db;
    private readonly storage;
    constructor(documents: DocumentService, db: Db, storage: ObjectStorage);
    /** 검사 대기 목록. 워커가 폴링한다. */
    pending(limit?: string): Promise<{
        documents: {
            documentId: string;
            objectKey: string;
            mediaType: string;
            sizeBytes: number;
            sha256: string;
            downloadUrl: string;
        }[];
    }>;
    scanResult(documentId: string, body: ScanResultBody): Promise<{
        documentId: string;
        result: "CLEAN" | "MALICIOUS" | "ERROR";
        status: "REJECTED" | "UPLOADING" | "QUARANTINED" | "AVAILABLE" | "DELETED";
    }>;
}
export {};
