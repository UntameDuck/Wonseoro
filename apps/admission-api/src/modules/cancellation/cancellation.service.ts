import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApplicationStatus, EVENT_TYPE, canCancel } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';

export interface CancelInput {
  applicationId: string;
  applicantId: string;
  reason: string;
  traceId?: string;
  sourceIp?: string;
}

export interface CancelResult {
  applicationId: string;
  status: 'CANCELLED';
  cancelledAt: string;
  /** 환불해야 할 결제가 있는가. 있으면 운영 큐에 올라가 사람이 처리한다. */
  refundRequired: boolean;
  paymentId: string | null;
}

/** 취소 사유는 이 길이 이상이어야 한다. 한 글자는 사유가 아니다. */
const MIN_REASON_LENGTH = 2;
const MAX_REASON_LENGTH = 500;

/**
 * 원서 취소 — 불일치 대장 D-7 판정에 따른 구현
 *
 * 설계서는 `CANCELLED` 를 DDL·OpenAPI enum 에만 두고 전이를 정의하지 않았다.
 * 여기서 구현한 규칙은 다음과 같고, **노션 §5.6 확인이 필요하다.**
 *
 * 1. 접수가 성립하기 **전** 에만 취소할 수 있다
 *    DRAFT · READY · PAYMENT_PENDING · PAID
 *
 * 2. `FINALIZED` 는 취소하지 않는다
 *    Submission 은 원장이다. 원장을 고쳐 쓰면 "무엇이 접수되었는가" 에 답할 수 없고,
 *    감사 해시체인과 Evidence Package 가 서 있는 전제가 무너진다.
 *    접수 후 취소가 필요하다면 상태를 덮는 것이 아니라 **취소 사실을 덧붙이는**
 *    별도 레코드여야 한다. 계약에 없으므로 지금은 거부하고 입학처로 안내한다.
 *
 * 3. `FINALIZING` 에서도 취소하지 않는다
 *    Finalize 가 비행 중이다. 취소와 커밋이 경합하면 "취소했는데 접수됨" 이 생긴다.
 *    조건부 UPDATE 와 Outbox 로 막아온 것이 정확히 그 종류의 사고다.
 *
 * 4. **환불은 자동으로 하지 않는다**
 *    확정된 결제가 있으면 운영 큐에 올리고 끝낸다. 금액과 귀책 판단이 따르고
 *    되돌릴 수 없는 일이다. 코드가 임의로 돈을 움직이지 않는다. (§B16)
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async cancel(input: CancelInput): Promise<CancelResult> {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < MIN_REASON_LENGTH) {
      // 사유 없는 취소는 나중에 분쟁이 됐을 때 아무것도 설명하지 못한다.
      throw ProblemException.validationFailed('취소 사유를 입력해 주십시오.');
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw ProblemException.validationFailed(
        `취소 사유는 ${MAX_REASON_LENGTH}자를 넘을 수 없습니다.`,
      );
    }

    return this.db.tx(async (client) => {
      const current = await this.load(client, input.applicationId);
      this.assertCancellable(current.status);

      // 조건부 UPDATE. 읽고-검사하고-쓰지 않는다. (§B3)
      // 이 사이에 Finalize 가 끼어들면 0건이 되고, 그게 정답이다.
      const moved = await client.query(
        `UPDATE application
            SET status = 'CANCELLED', version = version + 1, updated_at = now()
          WHERE id = $1 AND status = $2 AND version = $3`,
        [input.applicationId, current.status, current.version],
      );
      if (moved.rowCount === 0) {
        throw ProblemException.versionConflict(
          '원서 상태가 처리 중에 변경되었습니다. 최신 상태를 다시 확인해 주십시오.',
        );
      }

      const cancelledAt = new Date().toISOString();

      // 환불 의무가 있으면 운영 큐에 올린다. 여기서 돈을 움직이지 않는다.
      const refundRequired = current.confirmedPaymentId !== null;
      if (refundRequired) {
        await this.openRefundTask(client, {
          applicationId: input.applicationId,
          paymentId: current.confirmedPaymentId as string,
          amount: current.confirmedAmount,
          reason,
        });
      }

      await this.audit.record(client, {
        applicationId: input.applicationId,
        actorType: 'APPLICANT',
        actorId: input.applicantId,
        action: 'APPLICATION_CANCELLED',
        result: 'ACCEPTED',
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
        details: { from: current.status, to: 'CANCELLED', reason, refundRequired },
      });

      await this.enqueueCancelledEvent(client, {
        applicationId: input.applicationId,
        universityId: current.universityId,
        admissionYear: current.admissionYear,
        cancelledAt,
        refundRequired,
      });

      this.logger.log(
        `application ${input.applicationId} cancelled from ${current.status} ` +
          `(refundRequired=${refundRequired})`,
      );

      return {
        applicationId: input.applicationId,
        status: 'CANCELLED' as const,
        cancelledAt,
        refundRequired,
        paymentId: current.confirmedPaymentId,
      };
    });
  }

  /** 거부 사유를 상태별로 다르게 말한다. "불가능" 과 "지금은 안 된다" 는 다른 안내다. */
  private assertCancellable(status: ApplicationStatus): void {
    if (status === 'CANCELLED') {
      throw ProblemException.validationFailed('이미 취소된 원서입니다.');
    }
    if (status === 'FINALIZED') {
      throw ProblemException.cancellationAfterFinalize();
    }
    if (status === 'FINALIZING') {
      // 재시도하면 될 수도 있다. 영구 불가로 안내하면 사용자가 포기한다.
      throw ProblemException.versionConflict(
        '접수를 처리하는 중입니다. 잠시 후 다시 확인해 주십시오.',
      );
    }
    if (!canCancel(status)) {
      throw ProblemException.illegalTransition(status, 'CANCELLED');
    }
  }

  /**
   * 환불 대기 항목을 Exception Queue 에 올린다.
   *
   * 대조(Reconciliation)에도 같은 검사가 있다. 중복처럼 보이지만 둘 다 필요하다 —
   * 여기서 올리는 것은 즉시 보이게 하려는 것이고, 대조는 여기가 실패했을 때의 그물이다.
   * 부분 유니크 인덱스가 중복 등록을 막아준다. (D-25)
   */
  private async openRefundTask(
    client: PoolClient,
    src: { applicationId: string; paymentId: string; amount: number; reason: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,'REFUND_REQUIRED_AFTER_CANCEL','HIGH','OPEN',$3)
       ON CONFLICT (application_id, exception_type)
         WHERE state IN ('OPEN','MANUAL_REVIEW')
       DO NOTHING`,
      [
        randomUUID(),
        src.applicationId,
        JSON.stringify({
          paymentId: src.paymentId,
          amount: src.amount,
          cancelReason: src.reason,
        }),
      ],
    );
  }

  private async enqueueCancelledEvent(
    client: PoolClient,
    src: {
      applicationId: string;
      universityId: string;
      admissionYear: number;
      cancelledAt: string;
      refundRequired: boolean;
    },
  ): Promise<void> {
    const { rows } = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(aggregate_sequence), 0) + 1 AS next
         FROM outbox_event WHERE aggregate_id = $1`,
      [src.applicationId],
    );
    const sequence = Number(rows[0]?.next ?? 1);

    // 중앙에는 "취소됐다" 는 사실만 보낸다. 사유는 개인정보일 수 있어 보내지 않는다.
    const payload = {
      universityId: src.universityId,
      admissionYear: src.admissionYear,
      status: 'CANCELLED',
      cancelledAt: src.cancelledAt,
      refundRequired: src.refundRequired,
    };

    await client.query(
      `INSERT INTO outbox_event
         (id, aggregate_type, aggregate_id, aggregate_sequence, event_type,
          schema_version, payload, payload_hash, status)
       VALUES ($1,'APPLICATION',$2,$3,$4,'v1',$5,$6,'PENDING')`,
      [
        randomUUID(),
        src.applicationId,
        sequence,
        EVENT_TYPE.APPLICATION_CANCELLED,
        JSON.stringify(payload),
        createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      ],
    );
  }

  private async load(
    client: PoolClient,
    applicationId: string,
  ): Promise<{
    status: ApplicationStatus;
    version: string;
    universityId: string;
    admissionYear: number;
    confirmedPaymentId: string | null;
    confirmedAmount: number;
  }> {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT a.status, a.version, c.university_id, c.admission_year,
              p.id AS payment_id, p.amount
         FROM application a
         JOIN admission_cycle c ON c.id = a.cycle_id
         LEFT JOIN payment p
                ON p.application_id = a.id AND p.status = 'CONFIRMED'
        WHERE a.id = $1`,
      [applicationId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');

    return {
      status: String(r.status) as ApplicationStatus,
      version: String(r.version),
      universityId: String(r.university_id),
      admissionYear: Number(r.admission_year),
      confirmedPaymentId: r.payment_id ? String(r.payment_id) : null,
      confirmedAmount: r.amount ? Number(r.amount) : 0,
    };
  }
}
