import { Controller, Get, Header, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { ProblemException } from '../../common/problem/problem.exception';
import { serverNow } from '../../common/time/server-clock';
import { FinalizationService, SubmissionRow } from './finalization.service';

/**
 * 최종 접수 — canonical: k-admission-openapi.yaml
 *   finalizeApplication / getApplicationSubmission / getReceipt
 *
 * 재시도는 200, 신규 접수는 201. OpenAPI 가 둘을 구분한다.
 */
@Controller('api/v1')
export class FinalizationController {
  constructor(
    private readonly finalization: FinalizationService,
    private readonly ownership: Ownership,
  ) {}

  @Post('applications/:applicationId/finalize')
  @Header('cache-control', CACHE_CONTROL_PII)
  async finalize(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);

    const { submission, created } = await this.finalization.finalize({
      applicationId,
      applicantId,
      // 요청이 서버에 도달한 시각. 마감 정책이 이 값을 쓸 수 있다. (v1.1 §A2)
      // DB 시계에 맞춘 값이다 — Pod 마다 다른 시계로 요청 수신 시각을 찍지 않는다.
      requestedAt: serverNow(),
      ...this.context(req),
    });

    reply.status(created ? 201 : 200);
    return this.present(submission);
  }

  @Get('applications/:applicationId/submission')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const submission = await this.finalization.findSubmission(applicationId);
    if (!submission) {
      // 계약은 404 다. 원서는 본인 것이지만 접수 기록이 아직 없다.
      throw ProblemException.notFound('아직 접수되지 않은 원서입니다.');
    }
    return this.present(submission);
  }

  /**
   * 접수증. 발급할 때마다 감사에 남긴다(RECEIPT_ISSUED) — "접수증을 받았다" 는 지원자가
   * 접수 완료를 확인한 증거다. 접수증 화면은 지원자 웹의 인쇄용 페이지가 그린다.
   */
  @Get('submissions/:submissionId/receipt')
  @Header('cache-control', CACHE_CONTROL_PII)
  async receipt(@Param('submissionId') submissionId: string, @Req() req: FastifyRequest) {
    // 접수증에는 접수번호가 있다. 남의 접수번호를 알 수 있으면 안 된다.
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertSubmission(submissionId, applicantId);

    const submission = await this.finalization.issueReceipt(submissionId, applicantId, this.context(req));
    if (!submission) {
      throw ProblemException.notFound('존재하지 않는 접수입니다.');
    }
    return {
      submissionId: submission.submissionId,
      applicationNumber: submission.applicationNumber,
      finalizedAt: submission.finalizedAt,
    };
  }

  private present(s: SubmissionRow) {
    return {
      applicationId: s.applicationId,
      submissionId: s.submissionId,
      applicationNumber: s.applicationNumber,
      status: 'FINALIZED' as const,
      requestedAt: s.requestedAt,
      paymentVerifiedAt: s.paymentVerifiedAt,
      finalizedAt: s.finalizedAt,
      deadlinePolicyVersion: s.deadlinePolicyVersion,
      configVersion: s.configVersion,
      serverTime: serverNow().toISOString(),
    };
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
