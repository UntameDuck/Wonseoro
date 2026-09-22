import { Controller, Get, Header, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';
import { FinalizationService, SubmissionRow } from './finalization.service';

/**
 * 최종 접수 — canonical: k-admission-openapi.yaml
 *   finalizeApplication / getApplicationSubmission / getReceipt
 *
 * 재시도는 200, 신규 접수는 201. OpenAPI 가 둘을 구분한다.
 */
@Controller('api/v1')
export class FinalizationController {
  constructor(private readonly finalization: FinalizationService) {}

  @Post('applications/:applicationId/finalize')
  @Header('cache-control', CACHE_CONTROL_PII)
  async finalize(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { submission, created } = await this.finalization.finalize({
      applicationId,
      applicantId: this.applicantId(req),
      // 요청이 서버에 도달한 시각. 마감 정책이 이 값을 쓸 수 있다. (v1.1 §A2)
      requestedAt: new Date(),
      ...this.context(req),
    });

    reply.status(created ? 201 : 200);
    return this.present(submission);
  }

  @Get('applications/:applicationId/submission')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(@Param('applicationId') applicationId: string) {
    const submission = await this.finalization.findSubmission(applicationId);
    if (!submission) {
      throw ProblemException.validationFailed('아직 접수되지 않은 원서입니다.');
    }
    return this.present(submission);
  }

  @Get('submissions/:submissionId/receipt')
  @Header('cache-control', CACHE_CONTROL_PII)
  async receipt(@Param('submissionId') submissionId: string) {
    const submission = await this.finalization.findBySubmissionId(submissionId);
    if (!submission) {
      throw ProblemException.validationFailed('존재하지 않는 접수입니다.');
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
      serverTime: new Date().toISOString(),
    };
  }

  private applicantId(req: FastifyRequest): string {
    const id = req.headers['x-applicant-id'];
    if (typeof id !== 'string' || !id) {
      throw ProblemException.validationFailed('지원자를 식별할 수 없습니다.');
    }
    return id;
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
