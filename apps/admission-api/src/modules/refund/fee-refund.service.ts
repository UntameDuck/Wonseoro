import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  FEE_REFUND_ACCOUNT_LIMITS,
  FEE_REFUND_ACCOUNT_NUMBER,
  FEE_REFUND_DETAIL_MAX,
  FEE_REFUND_METHOD,
  FEE_REFUND_NOTE_MAX,
  FEE_REFUND_NUMBER,
  FEE_REFUND_REASON,
  FEE_REFUND_REASON_MIN,
  maskAccountNumber,
  type FeeRefundAccount,
  type FeeRefundMethod,
  type FeeRefundQueueItem,
  type FeeRefundReason,
  type FeeRefundStatus,
  type FeeRefundView,
} from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { openFields, sealField } from '../../common/db/field-cipher';
import type { Queryable } from '../../common/db/queryable';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';

/**
 * 전형료 반환·면제/감액 신청 — 고등교육법 시행령 제42조의3 (문서 10 G-5, 대장 D-89, `0010_fee_refund_request.sql`)
 *
 * 결제가 확인된 원서에만 받는다. 계좌·신청 내용·회신은 원서 데이터 키로 봉한다(묶음 `refund:<신청번호>:…`) —
 * 계좌번호는 금융정보다. 큐 줄과 지원자 화면에는 끝 네 자리 표기만 보이고, 원문은 입학처가 한 건을 열 때만(열람 감사).
 * 결정은 한 번 — 승인은 금액(낸 금액 이하), 거절은 사유. 실제 이체·방문 지급은 대학 재무 절차다.
 */
interface Row extends Record<string, unknown> {
  request_number: string;
  application_id: string;
  reason: FeeRefundReason;
  method: FeeRefundMethod;
  account_ciphertext: Buffer | null;
  account_masked: string | null;
  detail_ciphertext: Buffer | null;
  result_note_ciphertext: Buffer | null;
  paid_amount: string;
  approved_amount: string | null;
  status: FeeRefundStatus;
  received_at: Date;
  decided_at: Date | null;
}

interface QueueRow extends Row {
  decided_by: string | null;
  application_number: string | null;
  support_code: string;
  application_status: string;
}

export type RefundQueueFilter = 'OPEN' | 'DONE' | 'ALL';

const COLUMNS = `r.request_number, r.application_id, r.reason, r.method, r.account_ciphertext, r.account_masked,
                 r.detail_ciphertext, r.result_note_ciphertext, r.paid_amount, r.approved_amount, r.status,
                 r.received_at, r.decided_at`;
const QUEUE_COLUMNS = `${COLUMNS}, r.decided_by, s.application_number, a.support_code, a.status AS application_status`;
const QUEUE_FROM = `fee_refund_request r JOIN application a ON a.id = r.application_id
                    LEFT JOIN submission s ON s.application_id = r.application_id`;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NOT_FOUND = '이 신청번호로 받은 반환 신청이 없습니다. 번호를 다시 확인해 주십시오.';

@Injectable()
export class FeeRefundService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** 지원자가 반환을 신청한다. 검토 중 신청이 있으면 그것을 돌려준다(`created: false`) */
  async create(input: {
    applicationId: string;
    applicantId: string;
    reason: string;
    method: string;
    account?: unknown;
    detail?: unknown;
    traceId?: string;
    sourceIp?: string;
  }): Promise<{ created: boolean; request: FeeRefundView }> {
    if (!(FEE_REFUND_REASON as readonly string[]).includes(input.reason)) throw ProblemException.validationFailed('반환 사유를 골라 주십시오.');
    if (!(FEE_REFUND_METHOD as readonly string[]).includes(input.method)) throw ProblemException.validationFailed('돌려받을 방법을 골라 주십시오.');
    const reason = input.reason as FeeRefundReason;
    const method = input.method as FeeRefundMethod;
    const account = method === 'ACCOUNT' ? this.account(input.account) : null;
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    if (detail.length > FEE_REFUND_DETAIL_MAX) throw ProblemException.validationFailed(`신청 내용은 ${FEE_REFUND_DETAIL_MAX}자 이내로 적어 주십시오.`);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.tx(async (client) => {
          const locked = await client.query(`SELECT 1 FROM application WHERE id = $1 FOR NO KEY UPDATE`, [input.applicationId]);
          if (locked.rowCount === 0) throw ProblemException.notFound('원서를 찾을 수 없습니다.');
          const open = await client.query<Row>(
            `SELECT ${COLUMNS} FROM fee_refund_request r WHERE r.application_id = $1 AND r.status = 'RECEIVED'`,
            [input.applicationId],
          );
          if (open.rows[0]) return { created: false, request: await this.present(client, open.rows[0]) };

          // 돌려받을 돈이 있는 원서만 — 확인된 결제가 없으면(결제 전·이미 환불) 신청을 받지 않는다
          const paid = await client.query<{ amount: string }>(
            `SELECT amount FROM payment WHERE application_id = $1 AND status = 'CONFIRMED' ORDER BY verified_at DESC NULLS LAST LIMIT 1`,
            [input.applicationId],
          );
          if (!paid.rows[0]) throw ProblemException.versionConflict('전형료 결제가 확인된 원서만 반환을 신청할 수 있습니다.');

          const { rows } = await client.query<{ at: Date; day: string }>(
            `SELECT now() AS at, to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') AS day`,
          );
          const requestNumber = `FR-${rows[0]!.day}-${randomCrockford(6)}`;
          const sealedAccount = account ? await sealField(client, input.applicationId, `refund:${requestNumber}:account`, account) : null;
          const sealedDetail = detail ? await sealField(client, input.applicationId, `refund:${requestNumber}:detail`, detail) : null;
          const inserted = await client.query<Row>(
            `INSERT INTO fee_refund_request AS r
               (request_number, application_id, reason, method, account_ciphertext, account_masked, detail_ciphertext, paid_amount, received_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
            [requestNumber, input.applicationId, reason, method, sealedAccount, account ? maskAccountNumber(account.number) : null, sealedDetail, paid.rows[0].amount, rows[0]!.at],
          );
          // 계좌·내용은 감사 기록에 싣지 않는다
          await this.audit.record(client, {
            applicationId: input.applicationId,
            actorType: 'APPLICANT',
            actorId: input.applicantId,
            action: 'FEE_REFUND_REQUESTED',
            result: 'ACCEPTED',
            ...(input.traceId ? { traceId: input.traceId } : {}),
            ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
            details: { requestNumber, reason, method, paidAmount: Number(paid.rows[0].amount) },
          });
          return { created: true, request: await this.present(client, inserted.rows[0]!) };
        });
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (attempt < 2 && e?.code === '23505' && e.constraint === 'fee_refund_request_pkey') continue;
        throw err;
      }
    }
  }

  async listForApplication(applicationId: string): Promise<FeeRefundView[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM fee_refund_request r WHERE r.application_id = $1 ORDER BY r.received_at DESC`,
      [applicationId],
    );
    const out: FeeRefundView[] = [];
    for (const row of rows) out.push(await this.present(this.db, row));
    return out;
  }

  /** 입학처 큐 — 검토 중은 오래된 것부터, 결정 끝은 최근 결정부터. 계좌 원문·내용은 싣지 않는다 */
  async queue(filter: RefundQueueFilter = 'OPEN'): Promise<{ items: FeeRefundQueueItem[]; counts: { open: number } }> {
    const where = filter === 'OPEN' ? `r.status = 'RECEIVED'` : filter === 'DONE' ? `r.status <> 'RECEIVED'` : 'TRUE';
    const order = filter === 'DONE' ? 'r.decided_at DESC' : `(r.status = 'RECEIVED') DESC, r.received_at ASC`;
    const [list, counts] = await Promise.all([
      this.db.query<QueueRow>(`SELECT ${QUEUE_COLUMNS} FROM ${QUEUE_FROM} WHERE ${where} ORDER BY ${order} LIMIT 200`),
      this.db.query<{ open: string }>(`SELECT count(*) AS open FROM fee_refund_request WHERE status = 'RECEIVED'`),
    ]);
    return {
      items: list.rows.map((r) => this.queueItem(r, null, null, null)),
      counts: { open: Number(counts.rows[0]?.open ?? 0) },
    };
  }

  /** 담당자가 한 건을 연다 — 계좌·내용을 풀어 보이고 그 열람을 원서 체인에 남긴다 */
  async open(requestNumber: string, adminId: string): Promise<FeeRefundQueueItem> {
    const number = this.number(requestNumber);
    return this.db.tx(async (client) => {
      const row = await this.queueRow(client, number);
      await this.audit.record(client, {
        applicationId: row.application_id,
        actorType: 'ADMIN',
        actorId: adminId,
        action: 'ADMIN_VIEWED_PII',
        result: 'ACCEPTED',
        details: { purpose: 'FEE_REFUND', requestNumber: number },
      });
      const t = await this.texts(client, row);
      return this.queueItem(row, t.account, t.detail, t.resultNote);
    });
  }

  /** 한 번 결정한다 — 승인은 금액(1원 이상, 낸 금액 이하)과 안내, 거절은 사유(10자 이상) */
  async decide(input: { requestNumber: string; outcome: string; amount?: unknown; note: unknown; adminId: string }): Promise<FeeRefundQueueItem> {
    const number = this.number(input.requestNumber);
    if (input.outcome !== 'APPROVED' && input.outcome !== 'REJECTED') throw ProblemException.validationFailed('결정을 골라 주십시오.');
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length === 0) throw ProblemException.validationFailed('지원자에게 보낼 안내를 적어 주십시오.');
    if (note.length > FEE_REFUND_NOTE_MAX) throw ProblemException.validationFailed(`안내는 ${FEE_REFUND_NOTE_MAX}자 이내로 적어 주십시오.`);
    if (input.outcome === 'REJECTED' && note.length < FEE_REFUND_REASON_MIN) {
      throw ProblemException.validationFailed('반환하지 않을 때는 그 사유를 지원자가 알 수 있게 적어 주십시오.');
    }
    const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
    if (input.outcome === 'APPROVED' && (!Number.isInteger(amount) || amount < 1)) {
      throw ProblemException.validationFailed('돌려줄 금액을 원 단위 정수로 적어 주십시오.');
    }

    return this.db.tx(async (client) => {
      const locked = await client.query<{ application_id: string; status: string; paid_amount: string }>(
        `SELECT application_id, status, paid_amount FROM fee_refund_request WHERE request_number = $1 FOR UPDATE`,
        [number],
      );
      const current = locked.rows[0];
      if (!current) throw ProblemException.notFound(NOT_FOUND);
      if (current.status !== 'RECEIVED') throw ProblemException.versionConflict('이미 결정한 신청입니다. 목록을 새로 고쳐 주십시오.');
      if (input.outcome === 'APPROVED' && amount > Number(current.paid_amount)) {
        throw ProblemException.validationFailed('돌려줄 금액이 낸 전형료보다 많습니다.');
      }
      const sealed = await sealField(client, current.application_id, `refund:${number}:result`, note);
      await client.query(
        `UPDATE fee_refund_request SET status = $2, approved_amount = $3, decided_at = now(), decided_by = $4, result_note_ciphertext = $5
          WHERE request_number = $1`,
        [number, input.outcome, input.outcome === 'APPROVED' ? amount : null, input.adminId, sealed],
      );
      await this.audit.record(client, {
        applicationId: current.application_id,
        actorType: 'ADMIN',
        actorId: input.adminId,
        action: 'FEE_REFUND_DECIDED',
        result: 'ACCEPTED',
        details: { requestNumber: number, outcome: input.outcome, ...(input.outcome === 'APPROVED' ? { approvedAmount: amount } : {}) },
      });
      const row = await this.queueRow(client, number);
      const t = await this.texts(client, row);
      return this.queueItem(row, t.account, t.detail, t.resultNote);
    });
  }

  private account(value: unknown): FeeRefundAccount {
    const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const bank = typeof v.bank === 'string' ? v.bank.trim() : '';
    const holder = typeof v.holder === 'string' ? v.holder.trim() : '';
    const number = typeof v.number === 'string' ? v.number.replace(/\s/g, '') : '';
    if (!bank || bank.length > FEE_REFUND_ACCOUNT_LIMITS.bank) throw ProblemException.validationFailed('은행 이름을 적어 주십시오.');
    if (!holder || holder.length > FEE_REFUND_ACCOUNT_LIMITS.holder) throw ProblemException.validationFailed('예금주를 적어 주십시오.');
    if (!FEE_REFUND_ACCOUNT_NUMBER.test(number)) throw ProblemException.validationFailed('계좌번호는 숫자와 하이픈으로 적어 주십시오.');
    return { bank, holder, number };
  }

  private number(raw: string): string {
    const number = String(raw ?? '').trim().toUpperCase();
    if (!FEE_REFUND_NUMBER.test(number)) throw ProblemException.validationFailed('신청번호 형식이 아닙니다. 번호를 다시 확인해 주십시오.');
    return number;
  }

  private async queueRow(db: Queryable, number: string): Promise<QueueRow> {
    const { rows } = await db.query<QueueRow>(`SELECT ${QUEUE_COLUMNS} FROM ${QUEUE_FROM} WHERE r.request_number = $1`, [number]);
    if (!rows[0]) throw ProblemException.notFound(NOT_FOUND);
    return rows[0];
  }

  private async texts(db: Queryable, row: Row): Promise<{ account: FeeRefundAccount | null; detail: string | null; resultNote: string | null }> {
    const key = (k: string) => `refund:${row.request_number}:${k}`;
    const cells = (
      [
        ['account', row.account_ciphertext],
        ['detail', row.detail_ciphertext],
        ['result', row.result_note_ciphertext],
      ] as const
    )
      .filter(([, c]) => c)
      .map(([k, c]) => ({ field_code: key(k), value_json: null, value_ciphertext: c }));
    const opened = cells.length > 0 ? await openFields(db, row.application_id, cells) : {};
    const text = (k: string) => (typeof opened[key(k)] === 'string' ? (opened[key(k)] as string) : null);
    const acc = opened[key('account')];
    return {
      account: acc && typeof acc === 'object' ? (acc as FeeRefundAccount) : null,
      detail: text('detail'),
      resultNote: text('result'),
    };
  }

  private async present(db: Queryable, row: Row): Promise<FeeRefundView> {
    const { detail, resultNote } = await this.texts(db, row);
    return this.view(row, detail, resultNote);
  }

  private view(row: Row, detail: string | null, resultNote: string | null): FeeRefundView {
    return {
      requestNumber: row.request_number,
      reason: row.reason,
      method: row.method,
      accountMasked: row.account_masked,
      detail,
      status: row.status,
      paidAmount: Number(row.paid_amount),
      approvedAmount: row.approved_amount === null ? null : Number(row.approved_amount),
      receivedAt: row.received_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
      resultNote,
    };
  }

  private queueItem(row: QueueRow, account: FeeRefundAccount | null, detail: string | null, resultNote: string | null): FeeRefundQueueItem {
    return {
      ...this.view(row, detail, resultNote),
      applicationNumber: row.application_number,
      supportCode: row.support_code,
      applicationStatus: row.application_status,
      decidedBy: row.decided_by,
      account,
    };
  }
}

function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i]! % 32];
  return out;
}
