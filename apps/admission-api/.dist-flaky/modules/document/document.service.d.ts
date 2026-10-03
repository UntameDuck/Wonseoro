import { DocumentStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { FormSchemaService } from '../config/form-schema.service';
import { FileInspector } from './file-inspector';
import { ObjectStorage, PresignedUpload } from './object-storage';
export interface DocumentRow {
    id: string;
    applicationId: string;
    documentType: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    status: DocumentStatus;
}
export interface CreateIntentInput {
    applicationId: string;
    applicantId: string;
    documentType: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    traceId?: string;
    sourceIp?: string;
}
export interface CompleteInput {
    documentId: string;
    /** 클라이언트가 계산했다고 주장하는 값. 서버가 다시 계산해 대조한다. */
    sha256: string;
    sizeBytes: number;
    traceId?: string;
    sourceIp?: string;
}
/**
 * 서류 파이프라인 — 기술설계서 v1.0 §5.4, v1.1 §B5
 *
 *   upload-intent → 브라우저가 Object Storage 로 직접 업로드 → complete
 *     → 크기·magic-byte·해시 서버측 재검증
 *     → QUARANTINED → (AV 검사) → AVAILABLE
 *
 * 접수 확정에 쓸 수 있는 서류는 **AVAILABLE 상태뿐**이다. (v1.1 §10 §6)
 */
export declare class DocumentService {
    private readonly db;
    private readonly storage;
    private readonly inspector;
    private readonly audit;
    private readonly logger;
    private readonly forms;
    constructor(db: Db, storage: ObjectStorage, inspector: FileInspector, audit: AuditService, forms?: FormSchemaService);
    /**
     * 서류를 올리거나 지울 수 있는 원서인가 — 작성 중(DRAFT·READY)일 때만.
     * 결제를 시작한 원서의 서류를 바꾸면 결제 전 확인을 통과한 내용과 접수되는 내용이 달라진다(D-55).
     * 이 전형이 받는 서류 종류도 함께 돌려준다.
     */
    private assertDocumentsEditable;
    /**
     * 업로드 의도 생성. Presigned URL 을 발급한다.
     * 형식·확장자·크기는 **URL 을 내주기 전에** 거른다.
     */
    createIntent(input: CreateIntentInput): Promise<{
        documentId: string;
    } & PresignedUpload>;
    /**
     * 업로드 완료 신고. 여기서 실제 바이트를 검증한다.
     *
     * 클라이언트가 보낸 sha256 을 믿지 않는다. 서버가 다시 계산해 대조한다.
     * 결제의 "브라우저 성공값을 믿지 않는다"와 같은 원칙이다.
     */
    complete(input: CompleteInput): Promise<DocumentRow>;
    /**
     * AV 검사 결과 반영.
     *
     * 검사는 검사 워커(document-service)가 하고, 상태 전이 규칙은 여기 한 곳에만 있다 (ADR-0004).
     * 접수 확정이 AVAILABLE 기준이다. **어느 엔진이 어느 버전으로 검사했는지를 남긴다** —
     * 분쟁·사고 때 "무엇으로 검사했는가" 가 증적이다(Evidence Package). 전에는 워커가 보낸 엔진·버전을
     * 버리고 모든 기록에 'mock-av' 를 남겼다.
     */
    applyScanResult(documentId: string, result: 'CLEAN' | 'MALICIOUS' | 'ERROR', scanner?: string, engineVersion?: string | null, details?: Record<string, unknown>): Promise<DocumentStatus>;
    listByApplication(applicationId: string): Promise<DocumentRow[]>;
    /** 논리 삭제. 작성 중인 원서의 서류만 지울 수 있다 — 결제를 시작했거나 접수됐으면 안 된다. */
    remove(documentId: string, applicantId: string): Promise<void>;
    private markQuarantined;
    private markRejected;
    private load;
    private objectKeyOf;
    private toRow;
}
