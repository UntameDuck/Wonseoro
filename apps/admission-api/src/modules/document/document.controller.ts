import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { ProblemException } from '../../common/problem/problem.exception';
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
@Controller('api/v1')
export class DocumentController {
  constructor(
    private readonly documents: DocumentService,
    private readonly ownership: Ownership,
  ) {}

  @Post('applications/:applicationId/documents/upload-intents')
  @HttpCode(201)
  @Header('cache-control', CACHE_CONTROL_PII)
  async createIntent(
    @Param('applicationId') applicationId: string,
    @Body() body: IntentBody,
    @Req() req: FastifyRequest,
  ) {
    const documentType = this.required(body.documentType, 'documentType');
    const filename = this.required(body.filename, 'filename');
    const mediaType = this.required(body.mediaType, 'mediaType');
    if (typeof body.sizeBytes !== 'number') {
      throw ProblemException.validationFailed('sizeBytes 가 필요합니다.');
    }

    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);

    return this.documents.createIntent({
      applicationId,
      applicantId,
      documentType,
      filename,
      mediaType,
      sizeBytes: body.sizeBytes,
      ...this.context(req),
    });
  }

  @Post('documents/:documentId/complete')
  @HttpCode(202)
  @Header('cache-control', CACHE_CONTROL_PII)
  async complete(
    @Param('documentId') documentId: string,
    @Body() body: CompleteBody,
    @Req() req: FastifyRequest,
  ) {
    const sha256 = this.required(body.sha256, 'sha256');
    if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
      throw ProblemException.validationFailed('sha256 형식이 올바르지 않습니다.');
    }
    if (typeof body.sizeBytes !== 'number') {
      throw ProblemException.validationFailed('sizeBytes 가 필요합니다.');
    }

    // 업로드 완료 보고도 소유자만 할 수 있다. 남의 서류 상태를 바꿀 수 있으면
    // 검사 대기 중인 서류를 임의로 확정시킬 수 있다.
    await this.ownership.assertDocument(documentId, applicantFrom(req).applicantId);

    const doc = await this.documents.complete({
      documentId,
      sha256,
      sizeBytes: body.sizeBytes,
      ...this.context(req),
    });

    return {
      id: doc.id,
      status: doc.status,
      filename: doc.filename,
      mediaType: doc.mediaType,
      sizeBytes: doc.sizeBytes,
    };
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  async remove(@Param('documentId') documentId: string, @Req() req: FastifyRequest) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertDocument(documentId, applicantId);
    await this.documents.remove(documentId, applicantId);
  }

  private required(value: string | undefined, name: string): string {
    if (!value) throw ProblemException.validationFailed(`${name} 가 필요합니다.`);
    return value;
  }

  private context(req: FastifyRequest): { traceId?: string; sourceIp?: string } {
    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
    return {
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    };
  }
}
