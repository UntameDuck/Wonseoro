import { Body, Controller, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { CancellationService } from './cancellation.service';

interface CancelBody {
  reason?: string;
}

/**
 * 원서 취소 — 불일치 대장 D-7
 *
 * ⚠️ canonical OpenAPI 에 없는 경로다. `kr.kadmission.application.cancelled.v1`
 * 이벤트와 `application.status = 'CANCELLED'` 는 계약에 있는데 **이르는 길이 없었다.**
 * 계약 추가가 필요하다.
 *
 * 취소는 되돌릴 수 없으므로 다른 mutation 과 같이 Idempotency-Key 를 요구한다.
 * 네트워크가 끊겨 재시도된 요청이 두 번째 취소로 처리되면 안 된다.
 */
@Controller('api/v1/applications')
export class CancellationController {
  constructor(
    private readonly cancellation: CancellationService,
    private readonly ownership: Ownership,
  ) {}

  @Post(':applicationId/cancel')
  @HttpCode(200)
  @Header('cache-control', CACHE_CONTROL_PII)
  async cancel(
    @Param('applicationId') applicationId: string,
    @Body() body: CancelBody,
    @Req() req: FastifyRequest,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);

    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;

    return this.cancellation.cancel({
      applicationId,
      applicantId,
      reason: body?.reason ?? '',
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    });
  }
}
