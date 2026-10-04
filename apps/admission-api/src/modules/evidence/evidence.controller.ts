import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope, StepUp } from '../../common/identity/admin-scope';
import { adminFrom } from '../../common/identity/identity';
import { ProblemException } from '../../common/problem/problem.exception';
import { EvidenceService } from './evidence.service';

/**
 * Evidence Package — canonical: k-admission-openapi.yaml
 *   getEvidencePackage, security: [{ oidc: [auditor] }]
 *
 * oidc 모드: security-auditor 역할 + 비밀번호·OTP + **방금 한 인증**(Step-up)이어야 연다 (T-M5-10).
 * 그 밖의 모드: AdminGuard 의 공유 비밀, `x-admin-id` 는 열람자 기록용이다.
 *
 * **조회 사유가 필수다.** (§8.3)
 * 증적 열람은 그 자체로 감사 대상이고, 누가 왜 봤는지가 남아야 한다.
 * 계약에는 사유 파라미터가 없으므로 추가했다. (불일치 대장 D-24)
 */
@UseGuards(AdminGuard)
@AdminScope('auditor')
@Controller('admin/v1/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get('applications/:applicationId')
  @StepUp()
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Query('reason') reason?: string,
  ) {
    return this.evidence.generate(applicationId, adminFrom(req).adminId, reason ?? '');
  }

  /** 접수번호로 연다 — 같은 권한·재인증·사유·열람 기록 (U-51, 계약 getEvidencePackageByNumber) */
  @Get('by-number/:applicationNumber')
  @StepUp()
  @Header('cache-control', CACHE_CONTROL_PII)
  async getByNumber(
    @Param('applicationNumber') applicationNumber: string,
    @Req() req: FastifyRequest,
    @Query('reason') reason?: string,
  ) {
    if (!(reason ?? '').trim()) {
      throw ProblemException.validationFailed('조회 사유를 입력해야 합니다. 증적 열람은 기록으로 남습니다.');
    }
    const applicationId = await this.evidence.applicationIdByNumber(applicationNumber);
    return this.evidence.generate(applicationId, adminFrom(req).adminId, reason ?? '');
  }
}
