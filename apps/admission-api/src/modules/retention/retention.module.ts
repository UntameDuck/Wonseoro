import { Controller, Get, Header, Module, Query, UseGuards } from '@nestjs/common';
import { RETENTION_CATEGORIES } from '@wonseoro/contracts';
import { AdminGuard } from '../../common/identity/admin.guard';
import { ProblemException } from '../../common/problem/problem.exception';
import { RetentionService } from './retention.service';

/**
 * Retention Matrix 조회 — v1.1 §A15 (T-M3-10)
 *
 * 보존정책 **설정**은 여기 없다. Config 의 `retention` 섹션으로 들어가서
 * 2인 승인·Diff·서명된 적용 기록을 그대로 탄다. 보존기간을 줄이는 것은 파기를
 * 앞당기는 일이라 Diff 에서 DESTRUCTIVE 로 보인다.
 *
 * 계약에 없는 경로다. (D-38)
 */
@UseGuards(AdminGuard)
@Controller('admin/v1/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** 데이터 종류별 하한과 근거. 설정 화면이 이것을 보고 입력칸을 그린다. */
  @Get('matrix')
  @Header('cache-control', 'no-store')
  matrix() {
    return { categories: RETENTION_CATEGORIES };
  }

  /** 지금 적용 중인 정책으로 무엇이 언제 파기 대상인가. 지우지 않는다. */
  @Get('plan')
  @Header('cache-control', 'no-store')
  async plan(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('cycleId 가 필요합니다.');
    return this.retention.plan(cycleId);
  }
}

@Module({
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
