import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DocumentService } from './document.service';
import { ObjectStorage } from './object-storage';

interface ScanResultBody {
  result?: 'CLEAN' | 'MALICIOUS' | 'ERROR';
  scanner?: string;
  engineVersion?: string;
  /** 엔진이 찾은 것(악성코드 이름 등). 파일 내용·개인정보는 담지 않는다. */
  signature?: string;
}

/**
 * AV 검사 워커용 내부 API — 기술설계서 v1.0 §5.4, ADR-0004
 *
 * 계약: OpenAPI listDocumentsPendingScan · reportDocumentScanResult (D-20).
 *
 * `document-service` 가 QUARANTINED 서류를 가져가 검사하고 결과를 돌려준다.
 * 운영에서는 mTLS 로만 접근하며 외부에 노출하지 않는다. (M5 T-M5-05)
 */
@Controller('internal/v1/documents')
export class DocumentScanController {
  constructor(
    private readonly documents: DocumentService,
    private readonly db: Db,
    private readonly storage: ObjectStorage,
  ) {}

  /** 검사 대기 목록. 워커가 폴링한다. */
  @Get('pending-scan')
  @Header('cache-control', 'no-store')
  async pending(@Query('limit') limit?: string) {
    const max = Math.min(Number(limit ?? 50), 200);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT d.id, d.object_key, d.media_type, d.size_bytes, d.sha256_hex
         FROM document d
         JOIN document_scan s ON s.document_id = d.id AND s.result = 'PENDING'
        WHERE d.status = 'QUARANTINED'
        ORDER BY d.created_at
        LIMIT $1`,
      [max],
    );
    // 검사 엔진이 파일을 읽을 짧은 수명의 다운로드 URL 을 함께 준다. 워커에 Object Storage 자격증명을
    // 주지 않는다 — 워커는 이 URL 이 가리키는 파일 하나만, 몇 분 동안만 읽을 수 있다(최소권한, §06).
    const documents = [];
    for (const r of rows) {
      documents.push({
        documentId: String(r.id),
        objectKey: String(r.object_key),
        mediaType: String(r.media_type),
        sizeBytes: Number(r.size_bytes),
        sha256: String(r.sha256_hex),
        downloadUrl: await this.storage.presignDownload(String(r.object_key), String(r.id)),
      });
    }
    return { documents };
  }

  @Post(':documentId/scan-result')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async scanResult(@Param('documentId') documentId: string, @Body() body: ScanResultBody) {
    const result = body.result;
    if (result !== 'CLEAN' && result !== 'MALICIOUS' && result !== 'ERROR') {
      throw ProblemException.validationFailed(
        'result 는 CLEAN / MALICIOUS / ERROR 중 하나여야 합니다.',
      );
    }
    const status = await this.documents.applyScanResult(
      documentId,
      result,
      typeof body.scanner === 'string' && body.scanner ? body.scanner : 'unknown',
      typeof body.engineVersion === 'string' && body.engineVersion ? body.engineVersion : null,
      typeof body.signature === 'string' && body.signature ? { signature: body.signature.slice(0, 200) } : {},
    );
    return { documentId, result, status };
  }
}
