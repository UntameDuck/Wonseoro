import { Controller, Get, Header, Query } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';

/**
 * 내 원서 Dashboard — 기술설계서 v1.1 §10 §9
 *
 * **화면조회마다 대학 DB 를 호출하지 않는다.**
 * 대학이 보낸 State Event 로 갱신된 요약만 읽는다.
 * 사용자 수천 명이 Dashboard 를 열 때마다 전국 대학 DB 를 찌르면
 * 중앙이 다시 병목이 된다.
 *
 * 응답에 **마지막 동기화 시각**을 반드시 함께 준다.
 * 중앙은 언제나 뒤처질 수 있고, 그 사실을 숨기면 안 된다. (v1.1 §A3)
 */
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly db: Db) {}

  @Get('applications')
  @Header('cache-control', 'no-store')
  async list(@Query('applicantToken') applicantToken?: string) {
    // M2 임시: 중앙에는 지원자 식별자가 없으므로 전체를 돌려준다.
    // T-M1-09 Profile Vault 가 붙으면 applicantSubjectToken 으로 거른다.
    void applicantToken;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT university_id, application_id, admission_year, admission_type_code,
              department_code, status, application_number, submitted_at,
              last_sequence, last_synced_at
         FROM application_summary
        ORDER BY last_synced_at DESC
        LIMIT 100`,
    );

    return {
      serverTime: new Date().toISOString(),
      applications: rows.map((r) => ({
        universityId: String(r.university_id),
        applicationId: String(r.application_id),
        admissionYear: Number(r.admission_year),
        admissionTypeCode: String(r.admission_type_code),
        departmentCode: String(r.department_code),
        status: String(r.status),
        applicationNumber: r.application_number ? String(r.application_number) : null,
        submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
        // 이 값을 화면에 같이 보여준다. "언제 기준 상태인가"를 사용자가 알아야 한다.
        lastSyncedAt: (r.last_synced_at as Date).toISOString(),
      })),
    };
  }
}
