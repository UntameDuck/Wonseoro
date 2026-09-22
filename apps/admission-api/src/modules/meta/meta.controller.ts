import { Controller, Get, Header, Query } from '@nestjs/common';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { DeadlineService } from '../deadline/deadline.service';

/**
 * GET /api/v1/meta/time
 * canonical: k-admission-openapi.yaml — operationId getServerTime,
 *            응답 스키마 #/components/schemas/ServerTime
 *
 * 클라이언트는 자기 시계로 마감을 계산하지 않는다. (v1.1 §A2)
 * 남은 시간 표시·경고·제출 가능 여부 판단의 기준을 모두 이 응답에서 가져간다.
 */
@Controller('api/v1/meta')
export class MetaController {
  constructor(private readonly deadline: DeadlineService) {}

  @Get('time')
  @Header('cache-control', CACHE_CONTROL_PII)
  async time(@Query('admissionCycleId') admissionCycleId?: string) {
    return this.deadline.snapshot(admissionCycleId ?? 'default');
  }
}
