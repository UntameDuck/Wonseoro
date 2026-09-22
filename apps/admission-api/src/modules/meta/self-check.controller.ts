import { Controller, Get, Header, Param } from '@nestjs/common';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DeadlineService } from '../deadline/deadline.service';

interface TimelineEntry {
  at: string;
  what: string;
  result: string;
}

/**
 * Support Self-check — 기술설계서 v1.1 §01 C7 · §B11
 *
 * ⚠️ canonical OpenAPI 에 없는 엔드포인트다. 계약 추가 대기 중. (불일치 대장 D-16)
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
 */
@Controller('api/v1/applications')
export class SelfCheckController {
  constructor(
    private readonly db: Db,
    private readonly deadline: DeadlineService,
  ) {}

  @Get(':applicationId/self-check')
  @Header('cache-control', CACHE_CONTROL_PII)
  async selfCheck(@Param('applicationId') applicationId: string) {
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

      // ── 접수 상태. 이것이 사용자가 가장 알고 싶은 것이다 ──────────────
      application: {
        status: app.status,
        lastSavedAt: app.lastSavedAt,
        // 접수 완료 여부를 한 문장으로. 화면이 이걸 그대로 보여줘도 되게.
        summary: this.summarize(app.status, submission !== null),
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

  private summarize(status: string, hasSubmission: boolean): string {
    if (hasSubmission) return '접수가 완료되었습니다. 추가로 하실 일은 없습니다.';
    switch (status) {
      case 'DRAFT':
        return '작성 중입니다. 아직 접수되지 않았습니다.';
      case 'READY':
        return '작성이 끝났습니다. 전형료 결제가 남았습니다.';
      case 'PAYMENT_PENDING':
        return '결제 진행 중입니다. 결제창을 닫으셨다면 상태를 다시 확인해 주십시오.';
      case 'PAID':
      case 'FINALIZING':
        return '결제가 확인되었습니다. 접수 처리 중입니다. 다시 결제하지 마십시오.';
      case 'EXPIRED':
        return '마감되어 접수할 수 없습니다.';
      default:
        return `현재 상태: ${status}`;
    }
  }

  private async loadApplication(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, cycle_id, status, last_saved_at FROM application WHERE id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    return {
      cycleId: String(r.cycle_id),
      status: String(r.status),
      lastSavedAt: r.last_saved_at ? (r.last_saved_at as Date).toISOString() : null,
    };
  }

  private async latestPayment(applicationId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, status, amount, provider_approved_at, verified_at
         FROM payment WHERE application_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) return { exists: false, guidance: '아직 결제 내역이 없습니다.' };

    const status = String(r.status);
    return {
      exists: true,
      status,
      amount: Number(r.amount),
      providerApprovedAt: r.provider_approved_at
        ? (r.provider_approved_at as Date).toISOString()
        : null,
      verifiedAt: r.verified_at ? (r.verified_at as Date).toISOString() : null,
      // 재결제를 유도하지 않는다. 중복 결제가 확인 지연보다 큰 사고다. (v1.1 §B4)
      guidance:
        status === 'CONFIRMED'
          ? '결제가 확인되었습니다.'
          : status === 'UNKNOWN' || status === 'PENDING'
            ? '결제 확인 중입니다. 다시 결제하지 마시고 잠시 후 확인해 주십시오.'
            : status === 'FAILED' || status === 'CANCELLED'
              ? '결제가 완료되지 않았습니다. 다시 시도하실 수 있습니다.'
              : '결제 상태를 확인하는 중입니다.',
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
      `SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING')) AS pending,
              count(*) FILTER (WHERE status = 'SENT') AS sent,
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
      guidance:
        pending > 0
          ? '통합 조회 화면 반영이 지연되고 있습니다. 접수 자체는 이미 완료되었습니다.'
          : '통합 조회 화면까지 반영되었습니다.',
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
      what: LABELS[r.action] ?? r.action,
      result: r.result,
    }));
  }
}

/** 감사 액션을 사용자가 읽을 수 있는 말로 바꾼다. */
const LABELS: Record<string, string> = {
  LOGIN_SUCCEEDED: '로그인',
  APPLICATION_CREATED: '원서 생성',
  APPLICATION_SAVED: '원서 저장',
  DOCUMENT_UPLOAD_STARTED: '서류 업로드',
  DOCUMENT_VERIFIED: '서류 검사',
  PAYMENT_INTENT_CREATED: '결제 시작',
  PAYMENT_VERIFIED: '결제 확인',
  FINALIZE_REQUESTED: '접수 요청',
  FINALIZE_VALIDATION_PASSED: '접수 검증 통과',
  APPLICATION_FINALIZED: '접수 완료',
  RECEIPT_ISSUED: '접수증 발급',
};
