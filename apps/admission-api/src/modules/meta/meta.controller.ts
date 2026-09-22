import { Controller, Get, Header, Query } from '@nestjs/common';
import { DeadlineService } from '../deadline/deadline.service';

/**
 * GET /api/v1/meta/time — 기술설계서 v1.1 §03 · §A2
 *
 * 클라이언트는 자기 시계로 마감을 계산하지 않는다.
 * 남은 시간 표시·경고·제출 가능 여부 판단의 기준을 모두 이 응답에서 가져간다.
 */
@Controller('api/v1/meta')
export class MetaController {
  constructor(private readonly deadline: DeadlineService) {}

  @Get('time')
  @Header('cache-control', 'no-store')
  async time(@Query('admissionCycleId') admissionCycleId?: string) {
    const cycleId = admissionCycleId ?? 'default';
    const snapshot = await this.deadline.snapshot(cycleId);
    return {
      serverTime: snapshot.serverTime,
      deadlineAt: snapshot.deadlineAt,
      policyVersion: snapshot.policyVersion,
      remainingMs: snapshot.remainingMs,
      warningMinutes: snapshot.warningMinutes,
      passed: snapshot.passed,
    };
  }
}
