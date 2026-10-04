import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, PRIVACY_REQUEST_DUE_DAYS } from '@wonseoro/contracts';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope, StepUp } from '../../common/identity/admin-scope';
import { adminFrom, applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { PrivacyRequestService, type QueueFilter } from './privacy-request.service';

/**
 * 지원자 — 자기 원서의 열람·정정·삭제·처리정지 요청 (문서 10 G-10, D-84)
 * 계약: OpenAPI createPrivacyRequest · listPrivacyRequests. 소유자만(D-28).
 */
@Controller('api/v1/applications/:applicationId/privacy-requests')
export class PrivacyRequestController {
  constructor(
    private readonly requests: PrivacyRequestService,
    private readonly ownership: Ownership,
  ) {}

  @Post()
  @HttpCode(201)
  @Header('cache-control', CACHE_CONTROL_PII)
  async create(
    @Param('applicationId') applicationId: string,
    @Body() body: { kind?: unknown; detail?: unknown },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);
    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
    const { created, request } = await this.requests.create({
      applicationId,
      applicantId,
      kind: typeof body?.kind === 'string' ? body.kind : '',
      detail: body?.detail,
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    });
    // 같은 종류의 처리 중 요청이 이미 있으면 그것을 200 으로 — 새로 받은 것만 201
    reply.status(created ? 201 : 200);
    return request;
  }

  @Get()
  @Header('cache-control', CACHE_CONTROL_PII)
  async list(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);
    return { requests: await this.requests.listForApplication(applicationId), dueDays: PRIVACY_REQUEST_DUE_DAYS };
  }
}

/**
 * 입학처 — 권리 요청 처리 큐 (문서 10 G-10, D-84). 범위 `admin`(입학처 담당).
 * 큐 줄에는 요청 내용이 없다. 한 건을 열면(지원자가 쓴 내용 — 개인정보) 열람이 기록되고, 회신은 지원자에게 그대로
 * 보이므로 둘 다 재인증(Step-up)을 받는다 — 증적 열람과 같은 무게다.
 */
@UseGuards(AdminGuard)
@AdminScope('admin')
@Controller('admin/v1/privacy-requests')
export class PrivacyRequestAdminController {
  constructor(private readonly requests: PrivacyRequestService) {}

  @Get()
  @Header('cache-control', 'no-store')
  queue(@Query('status') status?: string, @Query('limit') limit?: string) {
    const filter: QueueFilter = status === 'DONE' || status === 'ALL' ? status : 'OPEN';
    return this.requests.queue(filter, limit ? Number(limit) : undefined);
  }

  @Get(':requestNumber')
  @StepUp()
  @Header('cache-control', 'no-store')
  open(@Param('requestNumber') requestNumber: string, @Req() req: FastifyRequest) {
    return this.requests.open(requestNumber, adminFrom(req).adminId);
  }

  @Post(':requestNumber/decision')
  @StepUp()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  decide(
    @Param('requestNumber') requestNumber: string,
    @Body() body: { outcome?: unknown; note?: unknown },
    @Req() req: FastifyRequest,
  ) {
    return this.requests.decide({
      requestNumber,
      outcome: typeof body?.outcome === 'string' ? body.outcome : '',
      note: body?.note,
      adminId: adminFrom(req).adminId,
    });
  }
}
