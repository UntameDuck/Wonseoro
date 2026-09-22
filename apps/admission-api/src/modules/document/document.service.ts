import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DocumentStatus } from '@wonseoro/contracts';
import { Db } from '../../infra/db/db.module';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
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
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly db: Db,
    private readonly storage: ObjectStorage,
    private readonly inspector: FileInspector,
    private readonly audit: AuditService,
  ) {}

  /**
   * 업로드 의도 생성. Presigned URL 을 발급한다.
   * 형식·확장자·크기는 **URL 을 내주기 전에** 거른다.
   */
  async createIntent(
    input: CreateIntentInput,
  ): Promise<{ documentId: string } & PresignedUpload> {
    this.inspector.precheck({
      filename: input.filename,
      declaredMediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
    });

    const documentId = randomUUID();
    const ext = input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase();
    // 사용자 파일명을 그대로 key 로 쓰지 않는다. 경로 조작과 충돌을 막는다.
    const objectKey = `applications/${input.applicationId}/${documentId}${ext}`;

    await this.db.tx(async (client) => {
      await client.query(
        `INSERT INTO document
           (id, application_id, document_type, object_key, original_filename,
            media_type, size_bytes, sha256_hex, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPLOADING')`,
        [
          documentId,
          input.applicationId,
          input.documentType,
          objectKey,
          input.filename,
          input.mediaType,
          input.sizeBytes,
          // 아직 모른다. complete 에서 실제 값으로 갱신한다.
          '0'.repeat(64),
        ],
      );
      await this.audit.record(client, {
        applicationId: input.applicationId,
        actorType: 'APPLICANT',
        actorId: input.applicantId,
        action: 'DOCUMENT_UPLOAD_STARTED',
        result: 'ACCEPTED',
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
        details: { documentType: input.documentType, mediaType: input.mediaType },
      });
    });

    const presigned = await this.storage.presignUpload(objectKey, input.mediaType);
    return { documentId, ...presigned };
  }

  /**
   * 업로드 완료 신고. 여기서 실제 바이트를 검증한다.
   *
   * 클라이언트가 보낸 sha256 을 믿지 않는다. 서버가 다시 계산해 대조한다.
   * 결제의 "브라우저 성공값을 믿지 않는다"와 같은 원칙이다.
   */
  async complete(input: CompleteInput): Promise<DocumentRow> {
    const doc = await this.load(input.documentId);
    if (doc.status !== 'UPLOADING') {
      throw ProblemException.validationFailed(
        `이미 처리된 서류입니다. (현재 상태: ${doc.status})`,
      );
    }

    const objectKey = await this.objectKeyOf(input.documentId);
    const actualSize = await this.storage.sizeOf(objectKey);
    if (actualSize === null) {
      throw ProblemException.validationFailed('업로드된 파일을 찾을 수 없습니다.');
    }

    const allowed = this.inspector.precheck({
      filename: doc.filename,
      declaredMediaType: doc.mediaType,
      sizeBytes: actualSize,
    });

    try {
      // 실제 내용이 선언한 형식과 같은지 본다.
      const head = await this.storage.readHead(objectKey, FileInspector.HEAD_BYTES);
      this.inspector.verifyContent(head, allowed);

      const body = await this.storage.readAll(objectKey);
      const actualHash = createHash('sha256').update(body).digest('hex');
      if (actualHash.toLowerCase() !== input.sha256.toLowerCase()) {
        throw ProblemException.validationFailed(
          '업로드된 파일의 해시가 일치하지 않습니다. 다시 업로드해 주십시오.',
        );
      }

      return await this.markQuarantined(doc, objectKey, actualHash, actualSize, input);
    } catch (err) {
      await this.markRejected(doc, input, err);
      throw err;
    }
  }

  /**
   * AV 검사 결과 반영.
   *
   * M1 은 Mock 이지만 **상태 전이는 실제로 구현한다.**
   * 접수 확정이 AVAILABLE 기준이므로 상태가 없으면 M2 Finalize 가 막힌다.
   * M5 에서 실제 스캐너로 교체한다. (T-M5-08)
   */
  async applyScanResult(
    documentId: string,
    result: 'CLEAN' | 'MALICIOUS' | 'ERROR',
    scanner = 'mock-av',
  ): Promise<DocumentStatus> {
    return this.db.tx(async (client) => {
      await client.query(
        `UPDATE document_scan
            SET result = $2, scanned_at = now()
          WHERE document_id = $1 AND result = 'PENDING'`,
        [documentId, result],
      );

      const next: DocumentStatus = result === 'CLEAN' ? 'AVAILABLE' : 'REJECTED';
      const updated = await client.query(
        `UPDATE document SET status = $2, updated_at = now()
          WHERE id = $1 AND status = 'QUARANTINED'`,
        [documentId, next],
      );
      if (updated.rowCount === 0) {
        throw ProblemException.validationFailed('검사 대기 상태의 서류가 아닙니다.');
      }

      const { rows } = await client.query<{ application_id: string }>(
        `SELECT application_id FROM document WHERE id = $1`,
        [documentId],
      );
      await this.audit.record(client, {
        ...(rows[0] ? { applicationId: rows[0].application_id } : {}),
        actorType: 'SYSTEM',
        actorId: scanner,
        action: 'DOCUMENT_VERIFIED',
        result: result === 'CLEAN' ? 'ACCEPTED' : 'REJECTED',
        details: { documentId, scanResult: result },
      });

      return next;
    });
  }

  async listByApplication(applicationId: string): Promise<DocumentRow[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, document_type, original_filename,
              media_type, size_bytes, status
         FROM document
        WHERE application_id = $1 AND status <> 'DELETED'
        ORDER BY created_at ASC`,
      [applicationId],
    );
    return rows.map((r) => this.toRow(r));
  }

  /** 논리 삭제. 접수 확정 이후에는 지울 수 없다. */
  async remove(documentId: string, applicantId: string): Promise<void> {
    const doc = await this.load(documentId);

    const { rows } = await this.db.query<{ status: string }>(
      `SELECT a.status FROM application a
         JOIN document d ON d.application_id = a.id
        WHERE d.id = $1`,
      [documentId],
    );
    if (rows[0]?.status === 'FINALIZED') {
      throw ProblemException.alreadyFinalized();
    }

    const objectKey = await this.objectKeyOf(documentId);
    await this.db.tx(async (client) => {
      await client.query(
        `UPDATE document SET status = 'DELETED', updated_at = now() WHERE id = $1`,
        [documentId],
      );
      await this.audit.record(client, {
        applicationId: doc.applicationId,
        actorType: 'APPLICANT',
        actorId: applicantId,
        action: 'APPLICATION_SAVED',
        result: 'ACCEPTED',
        details: { deletedDocumentId: documentId },
      });
    });

    await this.storage.remove(objectKey);
  }

  private async markQuarantined(
    doc: DocumentRow,
    objectKey: string,
    hash: string,
    size: number,
    input: CompleteInput,
  ): Promise<DocumentRow> {
    return this.db.tx(async (client) => {
      await client.query(
        `UPDATE document
            SET status = 'QUARANTINED', sha256_hex = $2, size_bytes = $3, updated_at = now()
          WHERE id = $1 AND status = 'UPLOADING'`,
        [doc.id, hash, size],
      );
      await client.query(
        `INSERT INTO document_scan (id, document_id, scanner, result)
         VALUES ($1,$2,$3,'PENDING')`,
        [randomUUID(), doc.id, 'mock-av'],
      );
      await this.audit.record(client, {
        applicationId: doc.applicationId,
        actorType: 'SYSTEM',
        action: 'DOCUMENT_UPLOAD_STARTED',
        result: 'ACCEPTED',
        ...(input.traceId ? { traceId: input.traceId } : {}),
        details: { documentId: doc.id, phase: 'QUARANTINED' },
      });
      this.logger.log(`document ${doc.id} quarantined (${size} bytes)`);
      return { ...doc, status: 'QUARANTINED' as DocumentStatus, sizeBytes: size };
    });
  }

  private async markRejected(
    doc: DocumentRow,
    input: CompleteInput,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.name : 'unknown';
    await this.db
      .tx(async (client) => {
        await client.query(
          `UPDATE document SET status = 'REJECTED', updated_at = now()
            WHERE id = $1 AND status = 'UPLOADING'`,
          [doc.id],
        );
        await this.audit.record(client, {
          applicationId: doc.applicationId,
          actorType: 'SYSTEM',
          action: 'DOCUMENT_VERIFIED',
          result: 'REJECTED',
          ...(input.traceId ? { traceId: input.traceId } : {}),
          details: { documentId: doc.id, reason },
        });
      })
      .catch(() => undefined);
  }

  private async load(documentId: string): Promise<DocumentRow> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, document_type, original_filename,
              media_type, size_bytes, status
         FROM document WHERE id = $1`,
      [documentId],
    );
    if (!rows[0]) throw ProblemException.validationFailed('존재하지 않는 서류입니다.');
    return this.toRow(rows[0]);
  }

  private async objectKeyOf(documentId: string): Promise<string> {
    const { rows } = await this.db.query<{ object_key: string }>(
      `SELECT object_key FROM document WHERE id = $1`,
      [documentId],
    );
    if (!rows[0]) throw ProblemException.validationFailed('존재하지 않는 서류입니다.');
    return rows[0].object_key;
  }

  private toRow(r: Record<string, unknown>): DocumentRow {
    return {
      id: String(r.id),
      applicationId: String(r.application_id),
      documentType: String(r.document_type),
      filename: String(r.original_filename),
      mediaType: String(r.media_type),
      sizeBytes: Number(r.size_bytes),
      status: r.status as DocumentStatus,
    };
  }
}
