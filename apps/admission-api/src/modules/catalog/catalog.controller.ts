import { Controller, Get, Header, Query } from '@nestjs/common';
import { pickUniversityNotices } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';

/**
 * 모집 카탈로그 — canonical: k-admission-openapi.yaml
 *   getCurrentCycle / listAdmissionTypes / listDepartments
 *
 * 조회성 트래픽이라 중앙에서 Cache 해도 되는 대상이지만 (v1.1 §10 §10),
 * **원본은 대학이 제공한다.** 중앙 검색이 죽어도 대학 직접 URL 로 접수할 수 있어야 하므로
 * 이 경로는 대학 Data Plane 에 있다. (v1.1 §10 §1)
 */
@Controller('api/v1')
export class CatalogController {
  constructor(private readonly db: Db) {}

  @Get('admission-cycles/current')
  @Header('cache-control', 'public, max-age=60')
  async currentCycle() {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT c.id, c.admission_year, c.name, c.opens_at, c.closes_at, c.status, c.university_id,
              u.name AS university_name
         FROM admission_cycle c
         JOIN university u ON u.id = c.university_id
        WHERE c.status = 'OPEN'
        ORDER BY c.opens_at DESC
        LIMIT 1`,
    );
    const r = rows[0];
    // 진행 중인 모집이 없는 것은 입력 오류가 아니다 — 계약대로 404.
    if (!r) throw ProblemException.notFound('진행 중인 모집이 없습니다.');
    // 지원자 고지(처리방침·위탁·보호책임자·문의처·전형료 반환) — 2인 승인으로 적용된 설정에서만, 알려진 문구만 (D-80)
    const notices = await this.db.query<{ notices: unknown }>(
      `SELECT config_json->'notices' AS notices FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE'
        ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
      [r.id],
    );
    return {
      id: String(r.id),
      universityId: String(r.university_id),
      // 화면에 대학 식별자(UNIV-A)가 아니라 이름을 보인다
      universityName: String(r.university_name),
      admissionYear: Number(r.admission_year),
      name: String(r.name),
      opensAt: (r.opens_at as Date).toISOString(),
      closesAt: (r.closes_at as Date).toISOString(),
      status: String(r.status),
      notices: pickUniversityNotices(notices.rows[0]?.notices),
    };
  }

  @Get('admission-types')
  @Header('cache-control', 'public, max-age=60')
  async admissionTypes(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('모집을 지정해 주십시오.');
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, code, name, fee_amount
         FROM admission_type
        WHERE cycle_id = $1 AND active = true
        ORDER BY code`,
      [cycleId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      // 전형료의 최종 기준은 대학 설정이다. 클라이언트가 계산하지 않는다. (v1.1 §10 §1)
      feeAmount: Number(r.fee_amount),
    }));
  }

  @Get('departments')
  @Header('cache-control', 'public, max-age=60')
  async departments(@Query('cycleId') cycleId?: string) {
    if (!cycleId) throw ProblemException.validationFailed('모집을 지정해 주십시오.');
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, code, name, quota
         FROM department
        WHERE cycle_id = $1 AND active = true
        ORDER BY code`,
      [cycleId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      quota: r.quota === null ? null : Number(r.quota),
    }));
  }
}
