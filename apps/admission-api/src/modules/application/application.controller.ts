import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, HEADER_IF_MATCH } from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';
import { UNIVERSITY_ID } from '../../config';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { FormSchemaService } from '../config/form-schema.service';
import { DeadlineService } from '../deadline/deadline.service';
import { ApplicationRepository, ApplicationRow } from './application.repository';

interface CreateBody {
  cycleId?: string;
  admissionTypeId?: string;
  departmentId?: string;
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

    // 마감 후에는 새 원서를 만들 수 없다. 서버 시각 기준이다.
    await this.deadline.assertWithinDeadline(cycleId, {
      requestReceivedAt: new Date(),
      commitAt: new Date(),
    });

    const { applicantId, subjectToken } = applicantFrom(req);
    const { row, created } = await this.repo.create({
      cycleId,
      applicantId,
      admissionTypeId,
      departmentId,
      ...(subjectToken ? { subjectToken } : {}),
      // 대학 식별자가 없으면 공통원서 Snapshot 조회가 조용히 건너뛰어진다.
      // 그래서 설정값이 아니라 기동 조건으로 둔다. (config.ts)
      universityId: UNIVERSITY_ID,
      ...this.context(req),
    });

    // 재시도로 기존 원서를 돌려준 경우는 200 이다. 새로 만든 경우만 201.
    reply.status(created ? 201 : 200);
    reply.header('etag', etagOf(row));
    return this.present(row, {});
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
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const expectedVersion = this.ifMatch(req);

    const current = await this.repo.findById(applicationId);
    if (!current) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    await this.deadline.assertWithinDeadline(current.cycleId, {
      requestReceivedAt: new Date(),
      commitAt: new Date(),
    });

    // 자동저장은 부분 입력을 허용하되 모르는 필드는 거부한다. (v1.1 §A5)
    // 모르는 필드를 받아두면 최종검증에서 원인을 찾기 어려워진다.
    const schemaVersion = await this.forms.assertKnownFields(
      current.cycleId,
      current.admissionTypeCode,
      body.fields ?? {},
    );

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
  async validate(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const row = await this.repo.findById(applicationId);
    if (!row) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    const fields = await this.repo.fields(applicationId);
    const result = await this.forms.validate(row.cycleId, row.admissionTypeCode, fields);

    const snapshot = await this.deadline.snapshot(row.cycleId);
    return {
      valid: result.valid,
      issues: result.issues,
      serverTime: snapshot.serverTime,
      deadlineAt: snapshot.deadlineAt,
      deadlinePolicyVersion: snapshot.deadlinePolicyVersion,
    };
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
        'If-Match 헤더가 필요합니다. 조회 응답의 ETag 를 그대로 보내십시오.',
      );
    }
    const parsed = raw.replace(/^W\//, '').replace(/"/g, '').trim();
    if (!/^\d+$/.test(parsed)) {
      throw ProblemException.validationFailed('If-Match 형식이 올바르지 않습니다.');
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
