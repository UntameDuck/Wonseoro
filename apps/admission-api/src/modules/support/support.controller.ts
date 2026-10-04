import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope } from '../../common/identity/admin-scope';
import { adminFrom } from '../../common/identity/identity';
import { SupportService } from './support.service';

/**
 * 개인정보 최소 상담 조회 — 노션 §01 B11 "자동 증적번호, PII 최소 Support View" (T-M6-07, 대장 D-79)
 *
 * 장애 중 고객센터 폭주 때 상담원이 이름·연락처 없이 접수번호나 상담 확인번호로 "서버가 아는 상태" 를 본다.
 * 조회는 그 자체로 기록이다 — 그래서 GET 이 아니라 POST 이고, 조회마다 증적번호가 생긴다.
 *
 * 범위 `support`(상담 담당·입학처 담당). Step-up 은 두지 않는다 — 장애 중 상담은 몇 분마다 이어지고,
 * 응답에 원서 내용·연락처가 없다. 비밀번호+OTP 로그인(acr=mfa)은 다른 운영 경로와 같이 요구한다.
 */
@UseGuards(AdminGuard)
@AdminScope('support')
@Controller('admin/v1/support/lookups')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  lookup(@Body() body: { key?: unknown; reason?: unknown }, @Req() req: FastifyRequest) {
    return this.support.lookup({
      key: typeof body?.key === 'string' ? body.key : '',
      reason: typeof body?.reason === 'string' ? body.reason : '',
      agentId: adminFrom(req).adminId,
    });
  }

  @Get(':evidenceNumber')
  @Header('cache-control', 'no-store')
  reopen(@Param('evidenceNumber') evidenceNumber: string) {
    return this.support.reopen(evidenceNumber);
  }
}
