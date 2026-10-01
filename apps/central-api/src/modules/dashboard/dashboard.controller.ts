import { Controller, Get, Header, Headers, HttpException, Query } from '@nestjs/common';
import { Db, purposeRef } from '@wonseoro/server-kit';
import { HEARTBEAT_STALE_SECONDS, SUBJECT_REF_KEYS } from '../../config';
import { subjectOf } from '../../identity';

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
    @Headers('x-subject-token') devToken?: string,
    @Query('applicantToken') inQuery?: string,
    @Headers('x-authenticated-subject') gatewayToken?: string,
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
          detail: '지원자 정보를 주소에 담아 보낼 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주십시오.',
        },
        400,
      );
    }
    // 인증 방식에 맞는 헤더만 본다 (AUTH_MODE). 운영에서 개발 헤더는 기동 단계에서 막힌다.
    const applicantToken = subjectOf({ dev: devToken, gateway: gatewayToken });

    // 대학이 보낸 것과 같은 방식으로 참조를 만든다. 원문 토큰은 저장하지 않는다.
    // 키 목록 전부로 만든다 — 키를 바꾸는 동안 옛 키로 만든 참조도 찾아져야 한다.
    const subjectRefs = SUBJECT_REF_KEYS.map((k) => purposeRef('DASHBOARD', k, applicantToken));

    // 대학 이름과 "지금 그 대학 서버가 살아 있는가" 를 함께 준다(심장박동, D-60). 한 대학이 멈춰도
    // 화면이 그 대학만 "확인 불가" 로 보이게 한다 — 나머지 대학 원서는 평소대로다 (T-M4-42).
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT a.university_id, u.name AS university_name, a.application_id, a.admission_year,
              a.admission_type_code, a.department_code, a.admission_type_name, a.department_name,
              a.status, a.application_number,
              a.submitted_at, a.last_sequence, a.last_synced_at, s.last_heartbeat_at,
              (s.last_heartbeat_at IS NOT NULL
                AND s.last_heartbeat_at > now() - make_interval(secs => $2)) AS reachable
         FROM application_summary a
         JOIN university_registry u ON u.id = a.university_id
         LEFT JOIN university_sync_state s ON s.university_id = a.university_id
        WHERE a.subject_ref = ANY($1::text[])
        ORDER BY a.last_synced_at DESC
        LIMIT 100`,
      [subjectRefs, HEARTBEAT_STALE_SECONDS],
    );

    return {
      serverTime: new Date().toISOString(),
      applications: rows.map((r) => ({
        universityId: String(r.university_id),
        universityName: String(r.university_name),
        // 심장박동이 끊긴 대학 — 이 행의 상태가 최신이 아닐 수 있다. 접수가 실패했다는 뜻은 아니다.
        universityReachable: r.reachable === true,
        universityLastHeartbeatAt: r.last_heartbeat_at ? (r.last_heartbeat_at as Date).toISOString() : null,
        applicationId: String(r.application_id),
        admissionYear: Number(r.admission_year),
        admissionTypeCode: String(r.admission_type_code),
        departmentCode: String(r.department_code),
        // 화면은 이름을 보인다 — 코드는 지원자가 읽을 말이 아니다(T-M5-51). 이름 없이 들어온 옛 행은 null
        admissionTypeName: r.admission_type_name ? String(r.admission_type_name) : null,
        departmentName: r.department_name ? String(r.department_name) : null,
        status: String(r.status),
        applicationNumber: r.application_number ? String(r.application_number) : null,
        submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
        // 이 값을 화면에 같이 보여준다. "언제 기준 상태인가"를 사용자가 알아야 한다.
        lastSyncedAt: (r.last_synced_at as Date).toISOString(),
      })),
    };
  }
}
