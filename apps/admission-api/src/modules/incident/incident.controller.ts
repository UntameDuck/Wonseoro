import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope, StepUp } from '../../common/identity/admin-scope';
import { adminFrom } from '../../common/identity/identity';
import { ProblemException } from '../../common/problem/problem.exception';
import { IncidentService, type IncidentSeverity, type IncidentStatus } from './incident.service';

@Controller('api/v1/meta')
export class PublicServiceStatusController {
  constructor(private readonly incidents: IncidentService) {}

  @Get('service-status')
  @Header('cache-control', 'no-store')
  status() {
    return this.incidents.publicStatus();
  }
}

@UseGuards(AdminGuard)
@AdminScope('operator')
@Controller('admin/v1/incidents')
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Get()
  @Header('cache-control', 'no-store')
  async list(@Query('status') status?: string) {
    const value = status ?? 'ALL';
    if (!['ACTIVE', 'RESOLVED', 'ALL'].includes(value)) {
      throw ProblemException.validationFailed('상태는 활성 / 해제 / 전체 중 하나여야 합니다.');
    }
    return { incidents: await this.incidents.list(value as IncidentStatus | 'ALL') };
  }

  @Post()
  @StepUp()
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  publish(
    @Body() body: { severity?: string; title?: string; message?: string; expectedResolvedAt?: string | null },
    @Req() req: FastifyRequest,
  ) {
    return this.incidents.publish({
      severity: (body?.severity ?? '') as IncidentSeverity,
      title: body?.title ?? '',
      message: body?.message ?? '',
      expectedResolvedAt: body?.expectedResolvedAt ?? null,
      operator: adminFrom(req).adminId,
    });
  }

  @Post(':incidentId/resolve')
  @StepUp()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  resolve(@Param('incidentId') incidentId: string, @Req() req: FastifyRequest) {
    return this.incidents.resolve(incidentId, adminFrom(req).adminId);
  }
}
