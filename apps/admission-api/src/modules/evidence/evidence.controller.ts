import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';
import { EvidenceService } from './evidence.service';

/**
 * Evidence Package — canonical: k-admission-openapi.yaml
 *   getEvidencePackage, security: [{ oidc: [auditor] }]
 *
 * ⚠️ 인증은 M5 다. 지금은 `x-admin-id` 로 열람자를 식별한다. (T-M5-10)
 *
 * **조회 사유가 필수다.** (§8.3)
 * 증적 열람은 그 자체로 감사 대상이고, 누가 왜 봤는지가 남아야 한다.
 * 계약에는 사유 파라미터가 없으므로 추가했다. (불일치 대장 D-24)
 */
@Controller('admin/v1/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get('applications/:applicationId')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Query('reason') reason?: string,
  ) {
    const viewer = req.headers['x-admin-id'];
    if (typeof viewer !== 'string' || !viewer) {
      throw ProblemException.forbidden('열람자를 식별할 수 없습니다.');
    }
    return this.evidence.generate(applicationId, viewer, reason ?? '');
  }
}
