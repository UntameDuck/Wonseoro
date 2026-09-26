import { Controller, Get, Header, Headers, HttpException, Query } from '@nestjs/common';
import { Db, purposeRef } from '@wonseoro/server-kit';
import { SUBJECT_REF_KEYS } from '../../config';

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
 *
 * 본인 것만 돌려준다. 전에는 요약 테이블에 지원자 참조가 없어 전체를 돌려주고 있었다.
 * 그건 조회가 아니라 유출이다. (불일치 대장 D-27)
 */
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly db: Db) {}

  @Get('applications')
  @Header('cache-control', 'no-store')
  async list(
    @Headers('x-subject-token') applicantToken?: string,
    @Query('applicantToken') inQuery?: string,
  ) {
    // 식별자를 URL 에 싣지 않는다. 프록시·접근 로그·브라우저 기록에 남는다. (§B8, D-39)
    if (inQuery) {
      throw new HttpException(
        {
          type: 'https://wonseoro.kr/problems/validation-failed',
          title: '요청이 올바르지 않습니다',
          status: 400,
          code: 'APPLICANT_TOKEN_IN_URL',
          traceId: '',
          detail: '지원자 식별자는 URL 이 아니라 x-subject-token 헤더로 보내야 합니다.',
        },
        400,
      );
    }
    if (!applicantToken) {
      throw new HttpException(
        {
          type: 'https://wonseoro.kr/problems/validation-failed',
          title: '요청이 올바르지 않습니다',
          status: 400,
          code: 'APPLICANT_TOKEN_REQUIRED',
          traceId: '',
          detail: 'applicantToken 이 필요합니다.',
        },
        400,
      );
    }

    // 대학이 보낸 것과 같은 방식으로 참조를 만든다. 원문 토큰은 저장하지 않는다.
    // 키 목록 전부로 만든다 — 키를 바꾸는 동안 옛 키로 만든 참조도 찾아져야 한다.
    const subjectRefs = SUBJECT_REF_KEYS.map((k) => purposeRef('DASHBOARD', k, applicantToken));

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT university_id, application_id, admission_year, admission_type_code,
              department_code, status, application_number, submitted_at,
              last_sequence, last_synced_at
         FROM application_summary
        WHERE subject_ref = ANY($1::text[])
        ORDER BY last_synced_at DESC
        LIMIT 100`,
      [subjectRefs],
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
