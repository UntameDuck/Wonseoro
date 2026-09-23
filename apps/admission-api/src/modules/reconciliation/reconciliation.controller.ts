import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminGuard } from '../../common/identity/admin.guard';
import { adminFrom } from '../../common/identity/identity';
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
/** D+1 배치 기준. §B18 */
const DEFAULT_SINCE_HOURS = 48;
/** 한 번의 대조가 훑을 수 있는 최대 범위. 30일. */
const MAX_SINCE_HOURS = 24 * 30;

@UseGuards(AdminGuard)
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
    // 범위를 열어두면 대조 한 번이 전체 이력을 훑어 DB 를 묶는다.
    // 장애 중에 부르는 API 라 더 위험하다.
    const sinceHours = body?.sinceHours ?? DEFAULT_SINCE_HOURS;
    if (!Number.isInteger(sinceHours) || sinceHours < 1 || sinceHours > MAX_SINCE_HOURS) {
      throw ProblemException.validationFailed(
        `sinceHours 는 1 이상 ${MAX_SINCE_HOURS} 이하의 정수여야 합니다.`,
      );
    }
    return this.reconciliation.reconcile(sinceHours);
  }

  @Post(':exceptionId/resolve')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async resolve(
    @Param('exceptionId') exceptionId: string,
    @Body() body: { resolutionCode?: string; reason?: string },
    @Req() req: FastifyRequest,
  ) {
    return this.reconciliation.resolve(
      exceptionId,
      adminFrom(req).adminId,
      body?.resolutionCode ?? '',
      body?.reason ?? '',
    );
  }
}
