import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PaymentStatus, PAYMENT_FINALIZABLE } from '@wonseoro/contracts';
import { Db } from '../../infra/db/db.module';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
import { PaymentProviderPort } from './payment.provider';

export interface PaymentRow {
  id: string;
  applicationId: string;
  provider: string;
  providerTxId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  providerApprovedAt: string | null;
  verifiedAt: string | null;
}

/**
 * 결제 — 기술설계서 v1.0 §5.5, v1.1 §A4·§B4
 *
 * **Payment 는 Application 과 별도 Aggregate 다.**
 * 결제 성공과 접수 성공을 같은 상태로 취급하면, PG callback 이 유실되거나
 * 늦게 올 때 "돈은 나갔는데 접수는 안 된" 상태가 설명 불가능해진다.
 *
 * 절대 규칙
 *   1. 클라이언트가 보낸 결제 성공 값을 신뢰하지 않는다. 서버가 PG 에 재조회한다.
 *   2. 응답을 못 받으면 UNKNOWN 이다. FAILED 로 떨어뜨리지 않는다.
 *      사용자에게 재결제를 유도하면 중복 결제가 된다. 그게 더 큰 사고다.
 *   3. Finalize 에 쓸 수 있는 상태는 CONFIRMED 하나뿐이다.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly db: Db,
    private readonly provider: PaymentProviderPort,
    private readonly audit: AuditService,
  ) {}

  /**
   * 전형료 결제 의도 생성.
   * 금액은 클라이언트가 보내지 않는다. 대학 설정(admission_type.fee_amount)이 최종 기준이다. (v1.1 §10 §1)
   */
  async createIntent(
    applicationId: string,
    applicantId: string,
    context: { traceId?: string; sourceIp?: string },
  ): Promise<{ payment: PaymentRow; providerPayload: Record<string, unknown> }> {
    const { rows } = await this.db.query<{ fee_amount: string; status: string }>(
      `SELECT t.fee_amount, a.status
         FROM application a
         JOIN admission_type t ON t.id = a.admission_type_id
        WHERE a.id = $1`,
      [applicationId],
    );
    const found = rows[0];
    if (!found) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    if (found.status === 'FINALIZED') throw ProblemException.alreadyFinalized();

    const amount = Number(found.fee_amount);
    const intent = await this.provider.createIntent(applicationId, amount);
    const paymentId = randomUUID();

    const payment = await this.db.tx(async (client) => {
      await client.query(
        `INSERT INTO payment
           (id, application_id, provider, provider_tx_id, amount, currency, status)
         VALUES ($1,$2,$3,$4,$5,'KRW','CREATED')`,
        [paymentId, applicationId, this.provider.name, intent.providerTxId, amount],
      );
      await this.audit.record(client, {
        applicationId,
        actorType: 'APPLICANT',
        actorId: applicantId,
        action: 'PAYMENT_INTENT_CREATED',
        result: 'ACCEPTED',
        ...(context.traceId ? { traceId: context.traceId } : {}),
        ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
        // 금액은 남겨도 되지만 결제수단 상세는 남기지 않는다. (v1.1 §04 Privacy)
        details: { paymentId, amount },
      });

      // ⚠️ 여기서 this.load() 를 부르면 안 된다.
      // load() 는 풀에서 **다른 커넥션**을 꺼내므로 아직 커밋되지 않은 이 INSERT 를
      // 볼 수 없다. 트랜잭션 안에서 읽을 때는 반드시 같은 client 를 써야 한다.
      return {
        id: paymentId,
        applicationId,
        provider: this.provider.name,
        providerTxId: intent.providerTxId,
        amount,
        currency: 'KRW',
        status: 'CREATED' as PaymentStatus,
        providerApprovedAt: null,
        verifiedAt: null,
      };
    });

    return { payment, providerPayload: intent.providerPayload };
  }

  /**
   * 서버측 재검증.
   *
   * 이 메서드는 **트랜잭션 밖에서** 호출된다. 외부 PG 호출이 들어 있기 때문이다.
   * 트랜잭션 안에서 부르면 락 유지 시간이 PG 지연에 묶인다. (v1.1 §B3)
   */
  async verify(paymentId: string, context: { traceId?: string } = {}): Promise<PaymentRow> {
    const payment = await this.load(paymentId);
    if (!payment.providerTxId) {
      throw ProblemException.validationFailed('결제 거래번호가 없습니다.');
    }
    // 이미 확정된 결제는 다시 묻지 않는다.
    if (payment.status === 'CONFIRMED') return payment;

    const result = await this.provider.verify(payment.providerTxId);

    // 금액이 다르면 확정하지 않는다. 결제창에서 금액이 바뀐 경우를 잡는다.
    if (
      result.status === 'CONFIRMED' &&
      result.amount !== undefined &&
      Number(result.amount) !== payment.amount
    ) {
      this.logger.error(`payment ${paymentId} amount mismatch`);
      return this.apply(payment, 'FAILED', result.providerApprovedAt, context);
    }

    return this.apply(payment, result.status, result.providerApprovedAt, context);
  }

  async load(paymentId: string): Promise<PaymentRow> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, provider, provider_tx_id, amount, currency,
              status, provider_approved_at, verified_at
         FROM payment WHERE id = $1`,
      [paymentId],
    );
    if (!rows[0]) throw ProblemException.validationFailed('존재하지 않는 결제입니다.');
    return this.toRow(rows[0]);
  }

  /**
   * Finalize 가 쓸 결제 스냅샷.
   * CONFIRMED 가 아니면 접수를 진행하지 않는다.
   */
  async confirmedFor(applicationId: string): Promise<PaymentRow> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, provider, provider_tx_id, amount, currency,
              status, provider_approved_at, verified_at
         FROM payment
        WHERE application_id = $1 AND status = 'CONFIRMED'
        ORDER BY verified_at DESC NULLS LAST
        LIMIT 1`,
      [applicationId],
    );
    if (!rows[0]) {
      throw ProblemException.paymentNotConfirmed();
    }
    const row = this.toRow(rows[0]);
    if (!PAYMENT_FINALIZABLE.includes(row.status)) {
      throw ProblemException.paymentNotConfirmed();
    }
    return row;
  }

  /** 상태 전이 + PaymentEvent 기록. 한 트랜잭션 안에서 한다. */
  private async apply(
    payment: PaymentRow,
    status: PaymentStatus,
    providerApprovedAt: string | undefined,
    context: { traceId?: string },
  ): Promise<PaymentRow> {
    return this.db.tx(async (client) => {
      await client.query(
        `UPDATE payment
            SET status = $2,
                provider_approved_at = COALESCE($3, provider_approved_at),
                verified_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [payment.id, status, providerApprovedAt ?? null],
      );

      // PG 응답 원문은 남기지 않는다. 해시와 마스킹된 요약만 남긴다. (v1.1 §04)
      await client.query(
        `INSERT INTO payment_event
           (id, payment_id, event_type, provider_event_id, payload_hash, payload_redacted, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [
          randomUUID(),
          payment.id,
          `VERIFY_${status}`,
          null,
          createHash('sha256')
            .update(`${payment.providerTxId}|${status}|${providerApprovedAt ?? ''}`)
            .digest('hex'),
          JSON.stringify({ status, providerApprovedAt: providerApprovedAt ?? null }),
        ],
      );

      await this.audit.record(client, {
        applicationId: payment.applicationId,
        actorType: 'SYSTEM',
        actorId: this.provider.name,
        action: 'PAYMENT_VERIFIED',
        result: status === 'CONFIRMED' ? 'ACCEPTED' : 'REJECTED',
        ...(context.traceId ? { traceId: context.traceId } : {}),
        details: { paymentId: payment.id, status },
      });

      return {
        ...payment,
        status,
        providerApprovedAt: providerApprovedAt ?? payment.providerApprovedAt,
        verifiedAt: new Date().toISOString(),
      };
    });
  }

  private toRow(r: Record<string, unknown>): PaymentRow {
    return {
      id: String(r.id),
      applicationId: String(r.application_id),
      provider: String(r.provider),
      providerTxId: r.provider_tx_id ? String(r.provider_tx_id) : null,
      amount: Number(r.amount),
      currency: String(r.currency),
      status: r.status as PaymentStatus,
      providerApprovedAt: r.provider_approved_at
        ? (r.provider_approved_at as Date).toISOString()
        : null,
      verifiedAt: r.verified_at ? (r.verified_at as Date).toISOString() : null,
    };
  }
}
