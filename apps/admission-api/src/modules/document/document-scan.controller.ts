import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DocumentService } from './document.service';

interface ScanResultBody {
  result?: 'CLEAN' | 'MALICIOUS' | 'ERROR';
  scanner?: string;
  engineVersion?: string;
}

/**
 * AV 검사 워커용 내부 API — 기술설계서 v1.0 §5.4, ADR-0004
 *
 * ⚠️ canonical OpenAPI 에 없다. 계약 추가 대기. (불일치 대장 D-20)
 *
 * `document-service` 가 QUARANTINED 서류를 가져가 검사하고 결과를 돌려준다.
 * 운영에서는 mTLS 로만 접근하며 외부에 노출하지 않는다. (M5 T-M5-05)
 */
@Controller('internal/v1/documents')
export class DocumentScanController {
  constructor(
    private readonly documents: DocumentService,
    private readonly db: Db,
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
    return {
      documents: rows.map((r) => ({
        documentId: String(r.id),
        objectKey: String(r.object_key),
        mediaType: String(r.media_type),
        sizeBytes: Number(r.size_bytes),
        sha256: String(r.sha256_hex),
      })),
    };
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
      body.scanner ?? 'unknown',
    );
    return { documentId, result, status };
  }
}
