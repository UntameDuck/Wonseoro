import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope, StepUp } from '../../common/identity/admin-scope';
import { adminFrom, applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { FeeRefundService, type RefundQueueFilter } from './fee-refund.service';

/**
 * 지원자 — 자기 원서의 전형료 반환·면제/감액 신청 (시행령 제42조의3, 문서 10 G-5, D-89)
 * 계약: OpenAPI createFeeRefund · listFeeRefunds. 소유자만(D-28).
 */
@Controller('api/v1/applications/:applicationId/fee-refunds')
export class FeeRefundController {
  constructor(
    private readonly refunds: FeeRefundService,
    private readonly ownership: Ownership,
  ) {}

  @Post()
  @HttpCode(201)
  @Header('cache-control', CACHE_CONTROL_PII)
  async create(
    @Param('applicationId') applicationId: string,
    @Body() body: { reason?: unknown; method?: unknown; account?: unknown; detail?: unknown },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);
    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
    const { created, request } = await this.refunds.create({
      applicationId,
      applicantId,
      reason: typeof body?.reason === 'string' ? body.reason : '',
      method: typeof body?.method === 'string' ? body.method : '',
      account: body?.account,
      detail: body?.detail,
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    });
    reply.status(created ? 201 : 200);
    return request;
  }

  @Get()
  @Header('cache-control', CACHE_CONTROL_PII)
  async list(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);
    return { requests: await this.refunds.listForApplication(applicationId) };
  }
}

/**
 * 입학처 — 전형료 반환 신청 큐 (D-89). 범위 `operator`(결제 대사와 같은 입학처 업무).
 * 한 건 열기(계좌 원문 — 금융정보)와 결정은 재인증(Step-up).
 */
@UseGuards(AdminGuard)
@AdminScope('operator')
@Controller('admin/v1/fee-refunds')
export class FeeRefundAdminController {
  constructor(private readonly refunds: FeeRefundService) {}

  @Get()
  @Header('cache-control', 'no-store')
  queue(@Query('status') status?: string) {
    const filter: RefundQueueFilter = status === 'DONE' || status === 'ALL' ? status : 'OPEN';
    return this.refunds.queue(filter);
  }

  @Get(':requestNumber')
  @StepUp()
  @Header('cache-control', 'no-store')
  open(@Param('requestNumber') requestNumber: string, @Req() req: FastifyRequest) {
    return this.refunds.open(requestNumber, adminFrom(req).adminId);
  }

  @Post(':requestNumber/decision')
  @StepUp()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  decide(
    @Param('requestNumber') requestNumber: string,
    @Body() body: { outcome?: unknown; amount?: unknown; note?: unknown },
    @Req() req: FastifyRequest,
  ) {
    return this.refunds.decide({
      requestNumber,
      outcome: typeof body?.outcome === 'string' ? body.outcome : '',
      amount: body?.amount,
      note: body?.note,
      adminId: adminFrom(req).adminId,
    });
  }
}
