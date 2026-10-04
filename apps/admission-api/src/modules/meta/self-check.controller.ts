import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AUDIT_ACTION_LABEL, CACHE_CONTROL_PII, labelOf } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { ProblemException } from '../../common/problem/problem.exception';
import { DeadlineService } from '../deadline/deadline.service';
import { applicationSummary, centralSyncGuidance, paymentGuidance } from './status-summary';

interface TimelineEntry {
  at: string;
  what: string;
  result: string;
}

/**
 * Support Self-check — 기술설계서 v1.1 §01 C7 · §B11
 *
 * 계약: OpenAPI getApplicationSelfCheck (D-16).
 *
 * **사용자가 "서버가 아는 상태"를 직접 본다.**
 *
 * 2026년 장애 때 지원자가 자기 접수 여부를 확인할 길은 고객센터뿐이었다.
 * 그 사이 재결제·중복 제출이 발생했고, 사후에 1,588건의 구제 신청으로 이어졌다.
 * 이 화면이 있었다면 상당수는 "이미 접수되었습니다"를 스스로 확인하고 끝났을 것이다.
 *
 * 설계 원칙
 *   1. **추측하지 않는다.** 서버가 아는 것만 보여준다. 모르면 모른다고 한다
 *   2. 재결제를 유도하지 않는다. 결제 상태가 불확실하면 "확인 중"이다
 *   3. 중앙 동기화 상태와 접수 상태를 **분리해서** 보여준다 (v1.1 §07)
 *      중앙에 안 갔다고 접수가 안 된 것이 아니다
 *   4. 개인정보를 싣지 않는다. 상태와 시각만 준다
 *   5. **본인 원서만 보여준다.** 접수번호·결제 상태·시도 이력이 담긴다. 남의 원서와 없는 원서는
 *      같은 404 다 — 구분해 주면 식별자를 훑어 유효한 원서를 찾을 수 있다. (D-28 에서 빠졌던 경로)
 */
@Controller('api/v1/applications')
export class SelfCheckController {
  constructor(
    private readonly db: Db,
    private readonly deadline: DeadlineService,
    private readonly ownership: Ownership,
  ) {}

  @Get(':applicationId/self-check')
  @Header('cache-control', CACHE_CONTROL_PII)
  async selfCheck(@Param('applicationId') applicationId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertApplication(applicationId, applicantFrom(req).applicantId);
    const app = await this.loadApplication(applicationId);
    const snapshot = await this.deadline.snapshot(app.cycleId);

    const [payment, submission, documents, outbox, timeline] = await Promise.all([
      this.latestPayment(applicationId),
      this.submission(applicationId),
      this.documents(applicationId),
      this.centralSync(applicationId),
      this.timeline(applicationId),
    ]);

    return {
      applicationId,
      serverTime: snapshot.serverTime,
      deadlineAt: snapshot.deadlineAt,
      deadlinePolicyVersion: snapshot.deadlinePolicyVersion,
      /**
       * 상담 확인번호 — 고객센터에 이름·연락처 대신 불러 주는 번호. 접수 전 원서에는 접수번호가 없다 (T-M6-07, D-79).
       * 상담원은 이 번호로 상태만 보고, 원서 내용·서류·연락처는 보지 못한다.
       */
      supportCode: app.supportCode,

      // ── 접수 상태. 이것이 사용자가 가장 알고 싶은 것이다 ──────────────
      application: {
        status: app.status,
        lastSavedAt: app.lastSavedAt,
        // 접수 완료 여부를 한 문장으로. 화면이 이걸 그대로 보여줘도 되게.
        summary: applicationSummary(app.status, submission !== null),
      },
      submission,

      // ── 결제. 불확실하면 불확실하다고 말한다 ─────────────────────────
      payment,

      documents,

      /**
       * 중앙 동기화. **접수 여부와 분리해서 보여준다.**
       * pending 이어도 접수는 이미 완료다. (v1.1 §10 §12)
       */
      centralSync: outbox,

      /** 저장·결제·제출 시도 이력. 구제 판정의 근거가 되는 그 기록이다 */
      timeline,
    };
  }

  private async loadApplication(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, cycle_id, status, last_saved_at, support_code FROM application WHERE id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    return {
      cycleId: String(r.cycle_id),
      status: String(r.status),
      lastSavedAt: r.last_saved_at ? (r.last_saved_at as Date).toISOString() : null,
      supportCode: String(r.support_code),
    };
  }

  private async latestPayment(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, status, amount, provider_approved_at, verified_at, created_at
         FROM payment WHERE application_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) return { exists: false, guidance: paymentGuidance(null) };

    const status = String(r.status);
    return {
      exists: true,
      // 화면이 새 결제를 만들지 않고 **이 결제**를 다시 확인할 수 있게 준다 (재결제 방지, §B4)
      paymentId: String(r.id),
      status,
      amount: Number(r.amount),
      // 결제를 요청한 시각 — 확인이 마감 뒤에 끝나도 이 시각이 판정 자료다. 화면이 확인 중에 보인다 (계약 1.6.0, U-56)
      requestedAt: (r.created_at as Date).toISOString(),
      providerApprovedAt: r.provider_approved_at
        ? (r.provider_approved_at as Date).toISOString()
        : null,
      verifiedAt: r.verified_at ? (r.verified_at as Date).toISOString() : null,
      // 재결제를 유도하지 않는다. 중복 결제가 확인 지연보다 큰 사고다. (v1.1 §B4)
      guidance: paymentGuidance(status),
    };
  }

  private async submission(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_number, finalized_at, deadline_policy_version
         FROM submission WHERE application_id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      submissionId: String(r.id),
      applicationNumber: String(r.application_number),
      finalizedAt: (r.finalized_at as Date).toISOString(),
      deadlinePolicyVersion: String(r.deadline_policy_version),
    };
  }

  private async documents(applicationId: string) {
    const { rows } = await this.db.query<{ document_type: string; status: string }>(
      `SELECT document_type, status FROM document
        WHERE application_id = $1 AND status <> 'DELETED'
        ORDER BY created_at`,
      [applicationId],
    );
    return rows.map((r) => ({
      documentType: r.document_type,
      status: r.status,
      guidance:
        r.status === 'AVAILABLE'
          ? '검사 완료'
          : r.status === 'QUARANTINED'
            ? '검사 중입니다'
            : r.status === 'REJECTED'
              ? '검사를 통과하지 못했습니다. 다시 올려 주십시오'
              : '업로드 중',
    }));
  }

  /**
   * 중앙 전송 현황.
   * pending 이 있어도 **접수는 이미 완료**다. 화면이 이 둘을 섞지 않게 문구를 함께 준다.
   */
  private async centralSync(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      // 보관 표로 옮긴 이벤트(T-M4-10)도 보낸 것으로 센다
      `SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING')) AS pending,
              count(*) FILTER (WHERE status = 'SENT')
                + (SELECT count(*) FROM outbox_event_archive WHERE aggregate_id = $1) AS sent,
              max(sent_at) AS last_sent_at
         FROM outbox_event WHERE aggregate_id = $1`,
      [applicationId],
    );
    const r = rows[0] ?? {};
    const pending = Number(r.pending ?? 0);
    return {
      pending,
      sent: Number(r.sent ?? 0),
      lastSentAt: r.last_sent_at ? (r.last_sent_at as Date).toISOString() : null,
      guidance: centralSyncGuidance(pending),
    };
  }

  /**
   * 저장·결제·제출 시도 이력.
   * 2026년 구제 판정에 쓰인 것이 바로 이 기록이다. 사용자가 직접 볼 수 있어야 한다.
   * 개인정보는 싣지 않는다 — 무엇을 언제 했는지만 준다.
   */
  private async timeline(applicationId: string): Promise<TimelineEntry[]> {
    const { rows } = await this.db.query<{ occurred_at: Date; action: string; result: string }>(
      `SELECT occurred_at, action, result FROM audit_event
        WHERE application_id = $1
        ORDER BY occurred_at ASC
        LIMIT 200`,
      [applicationId],
    );
    return rows.map((r) => ({
      at: r.occurred_at.toISOString(),
      what: labelOf(AUDIT_ACTION_LABEL, r.action),
      result: r.result,
    }));
  }
}
