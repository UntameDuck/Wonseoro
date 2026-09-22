import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ProblemException } from '../../common/problem/problem.exception';
import { ExceptionState, ReconciliationService } from './reconciliation.service';

/**
 * Reconciliation Center — canonical: k-admission-openapi.yaml
 *   listReconciliationExceptions / resolveReconciliationException
 *
 * ⚠️ `POST /admin/v1/reconciliation/run` 은 계약에 없다.
 * D+1 배치를 스케줄러로 돌리더라도 **수동 트리거가 있어야 한다** —
 * 장애 중에 운영자가 즉시 대조를 돌려야 하는 상황이 실제로 생긴다. (D-26)
 */
@Controller('admin/v1/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('exceptions')
  @Header('cache-control', 'no-store')
  async list(@Query('state') state?: string) {
    const valid: Array<ExceptionState | 'ALL'> = [
      'OPEN',
      'MANUAL_REVIEW',
      'RESOLVED',
      'AUTO_RESOLVED',
      'ALL',
    ];
    const s = (state ?? 'OPEN') as ExceptionState | 'ALL';
    if (!valid.includes(s)) {
      throw ProblemException.validationFailed(`state 는 ${valid.join(' / ')} 중 하나여야 합니다.`);
    }
    return { exceptions: await this.reconciliation.list(s) };
  }

  @Post('run')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async run(@Body() body: { sinceHours?: number }) {
    return this.reconciliation.reconcile(body?.sinceHours ?? 48);
  }

  @Post(':exceptionId/resolve')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async resolve(
    @Param('exceptionId') exceptionId: string,
    @Body() body: { resolutionCode?: string; reason?: string },
    @Req() req: FastifyRequest,
  ) {
    const who = req.headers['x-admin-id'];
    if (typeof who !== 'string' || !who) {
      throw ProblemException.forbidden('담당자를 식별할 수 없습니다.');
    }
    return this.reconciliation.resolve(
      exceptionId,
      who,
      body?.resolutionCode ?? '',
      body?.reason ?? '',
    );
  }
}
