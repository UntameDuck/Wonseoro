import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, HEADER_IF_MATCH } from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';
import { trackDraftSave } from '../../common/telemetry/business-metrics';
import { serverNow } from '../../common/time/server-clock';
import { UNIVERSITY_ID } from '../../config';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { FormSchemaService } from '../config/form-schema.service';
import { ConsentService } from '../config/consent.service';
import { DeadlineService } from '../deadline/deadline.service';
import { ApplicationRepository, ApplicationRow } from './application.repository';

interface CreateBody {
  cycleId?: string;
  admissionTypeId?: string;
  departmentId?: string;
  /** 원서를 만들 때 함께 하는 동의 코드 — 지금 판 문안에 대한 것 (G-2, D-81) */
  consents?: unknown;
  /** 접수 홈에서 지원 제한 고지를 확인했다 (G-12, D-86) */
  rulesAcknowledged?: unknown;
}

interface PatchBody {
  admissionTypeId?: string;
  departmentId?: string;
  fields?: Record<string, unknown>;
}

/**
 * Applicant API — 원서 생성 · 조회 · 자동저장
 * canonical: k-admission-openapi.yaml (createApplication / getApplication / updateApplication)
 *
 * 모든 응답에 serverTime 을 싣는다. 클라이언트가 자기 시계로 마감을 계산하지 않게 한다.
 */
@Controller('api/v1/applications')
export class ApplicationController {
  constructor(
    private readonly repo: ApplicationRepository,
    private readonly deadline: DeadlineService,
    private readonly forms: FormSchemaService,
    private readonly ownership: Ownership,
    private readonly consents: ConsentService,
  ) {}

  @Post()
  @HttpCode(201)
  @Header('cache-control', CACHE_CONTROL_PII)
  async create(
    @Body() body: CreateBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const cycleId = this.required(body.cycleId, 'cycleId');
    const admissionTypeId = this.required(body.admissionTypeId, 'admissionTypeId');
    const departmentId = this.required(body.departmentId, 'departmentId');

    // 마감 후에는 새 원서를 만들 수 없다. 서버 시각(DB 시계 기준) 이다. (§A2)
    const now = serverNow();
    await this.deadline.assertWithinDeadline(cycleId, { requestReceivedAt: now, commitAt: now });

    const { applicantId, subjectToken } = applicantFrom(req);
    // 공통원서에서 가져올 항목은 전형 양식이 정한다(`x-profile`). 코드에 박지 않는다. (§A5 · §10 §3)
    const typeCode = await this.repo.admissionTypeCode(cycleId, admissionTypeId);
    const { profileFields } = await this.forms.load(cycleId, typeCode);
    const { row, created } = await this.repo.create({
      cycleId,
      applicantId,
      admissionTypeId,
      departmentId,
      requestedFields: profileFields,
      ...(subjectToken ? { subjectToken } : {}),
      // 대학 식별자가 없으면 공통원서 Snapshot 조회가 조용히 건너뛰어진다.
      // 그래서 설정값이 아니라 기동 조건으로 둔다. (config.ts)
      universityId: UNIVERSITY_ID,
      ...this.context(req),
    });

    // 만들면서 한 동의 — 지금 판 문안에 대한 것만. 재시도(200)여도 다시 기록해 같은 결과다 (G-2, D-81)
    const consentCodes = Array.isArray(body.consents) ? body.consents.filter((c): c is string => typeof c === 'string') : [];
    if (consentCodes.length > 0) {
      await this.consents.record({
        applicationId: row.id,
        applicantId,
        changes: consentCodes.map((code) => ({ code, granted: true })),
        ...this.context(req),
      });
    }

    // 원서 작성 전에 지원 제한 고지를 확인했다 — 새로 만든 원서에만 남긴다(재시도는 같은 확인) (G-12, D-86)
    if (created && body.rulesAcknowledged === true) {
      await this.consents.acknowledgeRules({ applicationId: row.id, applicantId, cycleId, ...this.context(req) });
    }

    // 재시도로 기존 원서를 돌려준 경우는 200 이다. 새로 만든 경우만 201.
    reply.status(created ? 201 : 200);
    reply.header('etag', etagOf(row));
    // 공통원서에서 복사된 항목(재시도면 그동안 저장한 항목)을 그대로 돌려준다. 전에는 늘 빈 값이었다.
    return this.present(row, await this.repo.fields(row.id));
  }

  @Get(':applicationId')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // 원서 본문에는 자기소개서가 들어 있다. 식별자를 안다고 열람할 수 있으면 안 된다.
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const row = await this.repo.findById(applicationId);
    if (!row) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    const fields = await this.repo.fields(applicationId);
    reply.header('etag', etagOf(row));
    return this.present(row, fields);
  }

  /**
   * 자동저장.
   * If-Match 가 필수다. (OpenAPI #/components/parameters/IfMatch)
   * 버전이 어긋나면 412 로 돌려준다 — 사용자의 입력을 덮어쓰지 않는다.
   */
  @Patch(':applicationId')
  @Header('cache-control', CACHE_CONTROL_PII)
  async patch(
    @Param('applicationId') applicationId: string,
    @Body() body: PatchBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // draft_save_success_rate (T-M4-22)
    return trackDraftSave(() => this.save(applicationId, body, req, reply));
  }

  private async save(
    applicationId: string,
    body: PatchBody,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const expectedVersion = this.ifMatch(req);

    const current = await this.repo.findById(applicationId);
    if (!current) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    const now = serverNow();
    await this.deadline.assertWithinDeadline(current.cycleId, { requestReceivedAt: now, commitAt: now });

    // 자동저장은 부분 입력을 허용하되 모르는 필드는 거부한다. (v1.1 §A5)
    // 모르는 필드를 받아두면 최종검증에서 원인을 찾기 어려워진다.
    // 전형을 바꾸는 저장이면 **바뀔 전형**의 양식으로 본다 — 옛 전형 양식으로 보면 새 전형에 없는 항목이 들어간다.
    const typeCode = body.admissionTypeId
      ? await this.repo.admissionTypeCode(current.cycleId, body.admissionTypeId)
      : current.admissionTypeCode;
    const schemaVersion = await this.forms.assertKnownFields(
      current.cycleId,
      typeCode,
      body.fields ?? {},
    );
    // 여권번호 같은 항목은 별도 동의 뒤에만 저장한다 (보호법 제24조 ① 1, D-88)
    if (body.fields && Object.keys(body.fields).length > 0) {
      const { schema } = await this.forms.load(current.cycleId, typeCode);
      await this.consents.assertSensitiveFields(applicationId, current.cycleId, schema, body.fields);
    }

    const row = await this.repo.patch({
      applicationId,
      expectedVersion,
      ...(body.admissionTypeId ? { admissionTypeId: body.admissionTypeId } : {}),
      ...(body.departmentId ? { departmentId: body.departmentId } : {}),
      ...(body.fields ? { fields: body.fields } : {}),
      schemaVersion,
      ...this.context(req),
    });

    const fields = await this.repo.fields(applicationId);
    reply.header('etag', etagOf(row));
    return this.present(row, fields);
  }

  /**
   * 최종 검증. canonical: OpenAPI operationId validateApplication
   *
   * 예외를 던지지 않고 문제를 **전부 모아서** 돌려준다.
   * 사용자가 한 화면에서 고칠 것을 다 볼 수 있어야 한다. (v1.1 §07 Error Summary)
   */
  @Post(':applicationId/validate')
  @HttpCode(200)
  @Header('cache-control', CACHE_CONTROL_PII)
  async validate(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const row = await this.repo.findById(applicationId);
    if (!row) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    const fields = await this.repo.fields(applicationId);
    const checked = await this.forms.validate(row.cycleId, row.admissionTypeCode, fields);
    // 필수 동의가 빠졌으면 입력 오류와 함께 모아 준다 — 오류 요약이 1단계 동의 칸으로 데려간다 (G-2, D-81)
    const consentIssues = await this.consents.missingRequired(applicationId, row.cycleId);
    const result = { valid: checked.valid && consentIssues.length === 0, issues: [...consentIssues, ...checked.issues] };

    // 통과하면 작성 완료(READY), 저장 뒤 설정이 바뀌어 더는 맞지 않으면 작성 중(DRAFT)으로. (D-55)
    // 상태가 바뀌면 버전도 오른다 — 화면이 이어서 저장할 수 있게 새 ETag 를 준다.
    const moved = await this.repo.markValidated(applicationId, result.valid);
    if (moved) reply.header('etag', etagOf(moved));

    const snapshot = await this.deadline.snapshot(row.cycleId);
    return {
      valid: result.valid,
      issues: result.issues,
      serverTime: snapshot.serverTime,
      deadlineAt: snapshot.deadlineAt,
      deadlinePolicyVersion: snapshot.deadlinePolicyVersion,
    };
  }

  /**
   * 동의하거나 거둔다 — 작성 중·작성 완료 원서만. 계약: OpenAPI recordApplicationConsents (G-2, D-81)
   * 거두면 최종 검증·결제 전 확인이 막는다. 응답은 지금 판 문안과 이 원서의 동의 여부.
   */
  @Put(':applicationId/consents')
  @Header('cache-control', CACHE_CONTROL_PII)
  async recordConsents(
    @Param('applicationId') applicationId: string,
    @Body() body: { consents?: unknown },
    @Req() req: FastifyRequest,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);
    const changes = Array.isArray(body?.consents)
      ? body.consents
          .filter((c): c is { code: string; granted: boolean } =>
            !!c && typeof c === 'object' && typeof (c as { code?: unknown }).code === 'string' && typeof (c as { granted?: unknown }).granted === 'boolean')
          .map((c) => ({ code: c.code, granted: c.granted }))
      : [];
    return { consents: await this.consents.record({ applicationId, applicantId, changes, ...this.context(req) }) };
  }

  private async present(row: ApplicationRow, fields: Record<string, unknown>) {
    const snapshot = await this.deadline.snapshot(row.cycleId);
    return {
      id: row.id,
      cycleId: row.cycleId,
      admissionTypeId: row.admissionTypeId,
      departmentId: row.departmentId,
      status: row.status,
      version: Number(row.version),
      lastSavedAt: row.lastSavedAt,
      fields,
      serverTime: snapshot.serverTime,
      deadlineAt: snapshot.deadlineAt,
      deadlinePolicyVersion: snapshot.deadlinePolicyVersion,
    };
  }

  private required(value: string | undefined, name: string): string {
    if (!value) throw ProblemException.validationFailed(`${name} 가 필요합니다.`);
    return value;
  }

  private ifMatch(req: FastifyRequest): bigint {
    const raw = req.headers[HEADER_IF_MATCH];
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw ProblemException.validationFailed(
        '저장 기준 정보가 없습니다. 원서를 다시 불러온 뒤 저장해 주십시오.',
      );
    }
    const parsed = raw.replace(/^W\//, '').replace(/"/g, '').trim();
    if (!/^\d+$/.test(parsed)) {
      throw ProblemException.validationFailed('저장 기준 정보가 올바르지 않습니다. 원서를 다시 불러온 뒤 저장해 주십시오.');
    }
    return BigInt(parsed);
  }

  private context(req: FastifyRequest): { traceId?: string; sourceIp?: string } {
    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
    return {
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    };
  }
}

/** ETag 는 version 을 그대로 쓴다. 조건부 UPDATE 의 기대 버전과 같은 값이다. */
function etagOf(row: ApplicationRow): string {
  return `"${row.version}"`;
}
