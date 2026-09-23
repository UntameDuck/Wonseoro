import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { ProblemException } from '../../common/problem/problem.exception';
import { FormSchemaService } from './form-schema.service';

/**
 * 추가문항 스키마 조회 — 기술설계서 v1.1 §A5
 *
 * ⚠️ canonical OpenAPI 에 없는 엔드포인트다. 계약 추가 대기. (불일치 대장 D-19)
 *
 * **이 API 가 없으면 §A5 가 UI 에서 깨진다.**
 * 백엔드는 Config 만 바꿔 새 전형을 받을 수 있는데, 화면이 필드를 하드코딩하면
 * 전형이 늘 때마다 프론트를 고쳐야 한다. 그러면 "code fork 0" 이 아니다.
 *
 * 원서 단위로 준다. 스키마는 전형 × 활성 Config 버전의 조합이고,
 * 원서는 이미 둘 다 알고 있으므로 클라이언트가 조합을 계산할 필요가 없다.
 */
@Controller('api/v1/applications')
export class FormSchemaController {
  constructor(
    private readonly db: Db,
    private readonly forms: FormSchemaService,
    private readonly ownership: Ownership,
  ) {}

  @Get(':applicationId/form-schema')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    // 스키마 자체는 비밀이 아니지만, 원서 단위로 주는 API 다.
    // 남의 원서 식별자로 그 사람이 어느 전형에 지원했는지 알 수 있으면 안 된다.
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);

    const { rows } = await this.db.query<{ cycle_id: string; code: string }>(
      `SELECT a.cycle_id, t.code
         FROM application a
         JOIN admission_type t ON t.id = a.admission_type_id
        WHERE a.id = $1`,
      [applicationId],
    );
    const found = rows[0];
    if (!found) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    const { schemaVersion, schema } = await this.forms.load(found.cycle_id, found.code);
    return {
      admissionTypeCode: found.code,
      schemaVersion,
      schema,
    };
  }
}
