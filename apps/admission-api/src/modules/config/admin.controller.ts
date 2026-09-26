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
import { DeadlineMode } from '@wonseoro/contracts';
import { AdminGuard } from '../../common/identity/admin.guard';
import { adminFrom } from '../../common/identity/identity';
import { ProblemException } from '../../common/problem/problem.exception';
import { ActivationRecorder } from '../activation/activation-recorder';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { ConfigVersionService } from './config-version.service';

/**
 * 입학처 관리자 API — canonical: k-admission-openapi.yaml `/admin/v1/*`
 *
 * 기술설계서 v1.1 §A14·§C5, §01 E
 * **"단독 운영자 1명으로 마감시간 변경 불가"** 가 이 컨트롤러의 존재 이유다.
 *
 * ⚠️ 인증은 M5 다. (T-M5-10 Admin MFA + Step-up)
 * 그때까지는 AdminGuard 의 공유 비밀이 문을 지키고, `x-admin-id` 는 감사 기록용으로만 쓴다.
 * 공유 비밀은 누가 했는지 구분하지 못한다 — 문과 기록은 다른 문제다.
 *
 * ⚠️ `deadline-policies/{id}/activate` 는 계약에 없는 경로다. (불일치 대장 D-22)
 * ⚠️ `deadline-policies/extensions` · `activations` 도 계약에 없다. (D-35)
 *
 * 활성화·연장·되돌리기는 전부 **서명된 기록**으로 남는다. 누가 했는지는 `x-admin-id`
 * 에서 온다 — 공유 비밀 뒤라 신원 증명은 아니지만, 두 명의 서로 다른 승인자가
 * 서명된 기록에 함께 묶이므로 "한 사람이 혼자 바꿨다" 는 구별된다. (역할 분리는 T-M5-10)
 */
@UseGuards(AdminGuard)
@Controller('admin/v1')
export class AdminController {
  constructor(
    private readonly configs: ConfigVersionService,
    private readonly policies: DeadlinePolicyRepository,
    private readonly activations: ActivationRecorder,
  ) {}

  /* ── Config ──────────────────────────────────────────────────────── */

  @Get('config/active')
  @Header('cache-control', 'no-store')
  async activeConfig(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('cycleId 가 필요합니다.');
    const active = await this.configs.active(cycleId);
    if (!active) throw ProblemException.validationFailed('활성화된 설정이 없습니다.');
    return active;
  }

  /** 승인 대기함. 본문 없이 상태·승인자만. */
  @Get('config/versions')
  @Header('cache-control', 'no-store')
  async listConfigs(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('cycleId 가 필요합니다.');
    return { versions: await this.configs.list(cycleId) };
  }

  @Post('config/versions')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  async createConfig(
    @Body() body: { cycleId?: string; version?: string; config?: Record<string, unknown> },
    @Req() req: FastifyRequest,
  ) {
    return this.configs.createDraft({
      cycleId: this.required(body.cycleId, 'cycleId'),
      version: this.required(body.version, 'version'),
      config: body.config ?? {},
      createdBy: this.admin(req),
    });
  }

  /**
   * 승인 전에 무엇이 바뀌는지 본다. (§A14)
   * 이 응답의 `digest` 를 그대로 승인 요청에 실어 보낸다.
   */
  @Get('config/versions/:configId/diff')
  @Header('cache-control', 'no-store')
  async configDiff(@Param('configId') configId: string) {
    return this.configs.diff(configId);
  }

  /**
   * 승인. 본 Diff 의 digest 를 함께 받는다.
   * 승인자가 무엇이 바뀌는지 보지 못하면 두 명이 승인해도 사고를 막지 못한다.
   */
  @Post('config/versions/:configId/approve')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async approveConfig(
    @Param('configId') configId: string,
    @Body() body: { acknowledgedDiffDigest?: string },
    @Req() req: FastifyRequest,
  ) {
    const row = await this.configs.approve(
      configId,
      this.admin(req),
      this.required(body?.acknowledgedDiffDigest, 'acknowledgedDiffDigest'),
    );
    return {
      ...row,
      // 승인이 몇 명 남았는지 화면이 그대로 보여줄 수 있게 준다.
      remainingApprovals: Math.max(0, 2 - row.approvedBy.length),
    };
  }

  /**
   * 되돌리기. 전에 적용된 적이 있는 설정으로만 갈 수 있다.
   * 마감 임박 잠금은 여기 걸지 않는다 — 잘못된 설정으로 마감을 맞는 쪽이 더 큰 사고다.
   */
  @Post('config/versions/:configId/rollback')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async rollbackConfig(
    @Param('configId') configId: string,
    @Body() body: { reason?: string },
    @Req() req: FastifyRequest,
  ) {
    return this.configs.rollback({
      targetConfigId: configId,
      operator: this.admin(req),
      reason: body?.reason ?? '',
    });
  }

  @Post('config/versions/:configId/activate')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async activateConfig(
    @Param('configId') configId: string,
    @Body() body: { activateAt?: string },
    @Req() req: FastifyRequest,
  ) {
    return this.configs.activate(
      configId,
      body?.activateAt ? new Date(body.activateAt) : null,
      this.admin(req),
    );
  }

  /* ── Deadline Policy ─────────────────────────────────────────────── */

  @Post('deadline-policies')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  async createPolicy(
    @Body()
    body: { cycleId?: string; version?: string; mode?: string; deadlineAt?: string },
    @Req() req: FastifyRequest,
  ) {
    const mode = this.required(body.mode, 'mode') as DeadlineMode;
    return this.policies.createDraft({
      cycleId: this.required(body.cycleId, 'cycleId'),
      version: this.required(body.version, 'version'),
      mode,
      deadlineAt: this.required(body.deadlineAt, 'deadlineAt'),
      createdBy: this.admin(req),
    });
  }

  /**
   * 마감 연장 초안. (v1.1 §B17, T-M3-14)
   *
   * 지금 적용 중인 정책을 기준으로만 만들고, 사유와 **입학처 결정 문서번호**가 필수다.
   * 이 시스템은 연장을 결정하지 않는다. 입학처의 결정을 기록하고 집행한다.
   * 그 뒤는 일반 정책과 같다 — 작성자가 아닌 두 명이 승인해야 적용된다.
   */
  @Post('deadline-policies/extensions')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  async createExtension(
    @Body()
    body: { cycleId?: string; deadlineAt?: string; reason?: string; decisionRef?: string },
    @Req() req: FastifyRequest,
  ) {
    return this.policies.createExtension({
      cycleId: this.required(body?.cycleId, 'cycleId'),
      deadlineAt: this.required(body?.deadlineAt, 'deadlineAt'),
      reason: body?.reason ?? '',
      decisionRef: body?.decisionRef ?? '',
      createdBy: this.admin(req),
    });
  }

  @Post('deadline-policies/:policyId/approve')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async approvePolicy(@Param('policyId') policyId: string, @Req() req: FastifyRequest) {
    const result = await this.policies.approve(policyId, this.admin(req));
    return { policyId, ...result, remainingApprovals: result.complete ? 0 : 1 };
  }

  /** ⚠️ 계약에 없는 경로. Config 와 대칭을 맞추기 위해 추가했다. (D-22) */
  @Post('deadline-policies/:policyId/activate')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async activatePolicy(
    @Param('policyId') policyId: string,
    @Body() body: { activateAt?: string },
    @Req() req: FastifyRequest,
  ) {
    return this.policies.activate(
      policyId,
      body?.activateAt ? new Date(body.activateAt) : null,
      this.admin(req),
    );
  }

  /** 마감정책 변경 이력. 분쟁 시 "누가 언제 바꿨는가"에 답한다. (§A2) */
  @Get('deadline-policies')
  @Header('cache-control', 'no-store')
  async policyHistory(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('cycleId 가 필요합니다.');
    return { policies: await this.policies.history(cycleId) };
  }

  /**
   * 서명된 활성화 이력 — 마감 정책·설정 전부. (T-M3-15)
   * 조회할 때마다 서명을 다시 검증한다. 분쟁 시 "누가 언제 왜 적용했는가" 에 답한다.
   */
  @Get('activations')
  @Header('cache-control', 'no-store')
  async activationHistory(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('cycleId 가 필요합니다.');
    const [records, systemChain] = await Promise.all([
      this.activations.list(cycleId),
      this.activations.verifySystemChain(),
    ]);
    return {
      activations: records,
      // 하나라도 검증에 실패하면 목록 전체를 믿을 수 없다. 화면이 맨 위에 띄운다.
      allSignaturesValid: records.every((r) => r.signature === 'VALID'),
      // 서명은 남은 기록이 진짜인지, 체인은 빠진 기록이 없는지를 말한다.
      systemChain,
    };
  }

  private required(v: string | undefined, name: string): string {
    if (!v) throw ProblemException.validationFailed(`${name} 가 필요합니다.`);
    return v;
  }

  /** 감사에 남길 담당자. 인증이 아니라 기록이다. (T-M5-10 에서 OIDC 신원으로 교체) */
  private admin(req: FastifyRequest): string {
    return adminFrom(req).adminId;
  }
}
