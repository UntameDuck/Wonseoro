import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  PRIVACY_REQUEST_DETAIL_MAX,
  PRIVACY_REQUEST_DUE_DAYS,
  PRIVACY_REQUEST_DUE_SOON_DAYS,
  PRIVACY_REQUEST_KIND,
  PRIVACY_REQUEST_NOTE_MAX,
  PRIVACY_REQUEST_NUMBER,
  PRIVACY_REQUEST_OUTCOME,
  PRIVACY_REQUEST_REASON_MIN,
  type PrivacyQueueItem,
  type PrivacyRequestKind,
  type PrivacyRequestOutcome,
  type PrivacyRequestStatus,
  type PrivacyRequestView,
} from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { openFields, sealField } from '../../common/db/field-cipher';
import type { Queryable } from '../../common/db/queryable';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';

/**
 * 정보주체 권리 요청 — 대학 원서의 열람·정정·삭제·처리정지 (문서 10 G-10, 대장 D-84, `0009_privacy_request.sql`)
 *
 * 받는 것·기한을 지키는 것·결과를 남기는 것까지가 여기 몫이다. 실제 정정·삭제·처리정지는 입학처가
 * 대학 규정과 보존 의무(접수 원서 10년 등)를 따져 정한 절차로 하고, 그 결과를 회신으로 남긴다 —
 * 시스템이 요청만 보고 접수 원서를 지우면 법정 보존 의무를 어긴다.
 *
 * 지원자가 쓴 내용·입학처 회신은 원서 데이터 키로 봉한다(항목 값과 같은 봉투, 묶음 `privacy:<요청번호>:…`).
 * 시각·기한은 DB 시계다(§A2).
 */
interface Row extends Record<string, unknown> {
  request_number: string;
  application_id: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  detail_ciphertext: Buffer | null;
  result_note_ciphertext: Buffer | null;
  received_at: Date;
  due_at: Date;
  decided_at: Date | null;
}

interface QueueRow extends Row {
  decided_by: string | null;
  application_number: string | null;
  support_code: string;
  application_status: string;
  days_left: number;
  overdue: boolean;
}

export type QueueFilter = 'OPEN' | 'DONE' | 'ALL';

export interface PrivacyQueue {
  items: PrivacyQueueItem[];
  counts: { open: number; overdue: number; dueSoon: number };
}

const COLUMNS = `r.request_number, r.application_id, r.kind, r.status, r.detail_ciphertext, r.result_note_ciphertext,
                 r.received_at, r.due_at, r.decided_at`;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NOT_FOUND = '이 요청번호로 받은 요청이 없습니다. 번호를 다시 확인해 주십시오.';

@Injectable()
export class PrivacyRequestService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * 지원자가 자기 원서에 요청을 남긴다. 같은 종류의 처리 중 요청이 있으면 그것을 돌려준다(`created: false`) —
   * 두 번 눌러도 요청이 둘이 되지 않고, 처음 받은 날의 기한이 그대로다.
   * 원서 상태와 무관하게 받는다 — 접수·취소·마감된 원서도 정보주체의 권리는 그대로다.
   */
  async create(input: {
    applicationId: string;
    applicantId: string;
    kind: string;
    detail?: unknown;
    traceId?: string;
    sourceIp?: string;
  }): Promise<{ created: boolean; request: PrivacyRequestView }> {
    if (!(PRIVACY_REQUEST_KIND as readonly string[]).includes(input.kind)) {
      throw ProblemException.validationFailed('요청 종류를 골라 주십시오.');
    }
    const kind = input.kind as PrivacyRequestKind;
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    if (detail.length > PRIVACY_REQUEST_DETAIL_MAX) {
      throw ProblemException.validationFailed(`요청 내용은 ${PRIVACY_REQUEST_DETAIL_MAX}자 이내로 적어 주십시오.`);
    }
    if (kind === 'CORRECTION' && detail.length === 0) {
      throw ProblemException.validationFailed('정정 요청은 무엇을 어떻게 바로잡을지 적어 주십시오.');
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.tx(async (client) => {
          // 원서 행을 먼저 잠근다 — 같은 원서의 동시 요청이 줄을 서서, "처리 중 요청이 있나" 확인이 겹치지 않는다
          const locked = await client.query(`SELECT 1 FROM application WHERE id = $1 FOR NO KEY UPDATE`, [input.applicationId]);
          if (locked.rowCount === 0) throw ProblemException.notFound('원서를 찾을 수 없습니다.');

          const open = await client.query<Row>(
            `SELECT ${COLUMNS} FROM privacy_request r WHERE r.application_id = $1 AND r.kind = $2 AND r.status = 'RECEIVED'`,
            [input.applicationId, kind],
          );
          if (open.rows[0]) return { created: false, request: await this.present(client, open.rows[0]) };

          const { rows } = await client.query<{ at: Date; due: Date; day: string }>(
            `SELECT now() AS at, now() + make_interval(days => $1) AS due,
                    to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') AS day`,
            [PRIVACY_REQUEST_DUE_DAYS],
          );
          const { at, due, day } = rows[0]!;
          const requestNumber = `PR-${day}-${randomCrockford(6)}`;
          const sealed = detail ? await sealField(client, input.applicationId, `privacy:${requestNumber}:detail`, detail) : null;
          const inserted = await client.query<Row>(
            `INSERT INTO privacy_request AS r (request_number, application_id, kind, detail_ciphertext, received_at, due_at)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
            [requestNumber, input.applicationId, kind, sealed, at, due],
          );
          // 원서 체인에 잇는다 — 요청 내용(개인정보일 수 있다)은 싣지 않는다
          await this.audit.record(client, {
            applicationId: input.applicationId,
            actorType: 'APPLICANT',
            actorId: input.applicantId,
            action: 'PRIVACY_REQUEST_RECEIVED',
            result: 'ACCEPTED',
            ...(input.traceId ? { traceId: input.traceId } : {}),
            ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
            details: { requestNumber, kind, dueAt: due.toISOString() },
          });
          return { created: true, request: await this.present(client, inserted.rows[0]!) };
        });
      } catch (err) {
        // 같은 날 같은 6자가 겹치면 새 번호로 다시
        const e = err as { code?: string; constraint?: string };
        if (attempt < 2 && e?.code === '23505' && e.constraint === 'privacy_request_pkey') continue;
        throw err;
      }
    }
  }

  /** 지원자가 자기 원서의 요청과 회신을 본다 — 최근 것부터 */
  async listForApplication(applicationId: string): Promise<PrivacyRequestView[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM privacy_request r WHERE r.application_id = $1 ORDER BY r.received_at DESC`,
      [applicationId],
    );
    const out: PrivacyRequestView[] = [];
    for (const row of rows) out.push(await this.present(this.db, row));
    return out;
  }

  /**
   * 입학처 처리 큐. 처리 중은 기한이 급한 것부터, 처리 끝은 최근 회신부터.
   * 줄에는 요청 내용을 싣지 않는다 — 내용은 한 건씩 열고(`open`) 그 열람이 기록된다.
   */
  async queue(filter: QueueFilter = 'OPEN', limit = 200): Promise<PrivacyQueue> {
    const where = filter === 'OPEN' ? `r.status = 'RECEIVED'` : filter === 'DONE' ? `r.status <> 'RECEIVED'` : 'TRUE';
    const order = filter === 'DONE' ? 'r.decided_at DESC' : `(r.status = 'RECEIVED') DESC, r.due_at ASC`;
    const [list, counts] = await Promise.all([
      this.db.query<QueueRow>(
        `SELECT ${this.queueColumns()}
           FROM privacy_request r
           JOIN application a ON a.id = r.application_id
           LEFT JOIN submission s ON s.application_id = r.application_id
          WHERE ${where}
          ORDER BY ${order}
          LIMIT $1`,
        [Math.min(Math.max(Math.trunc(limit) || 200, 1), 500)],
      ),
      this.db.query<{ open: string; overdue: string; due_soon: string }>(
        `SELECT count(*) AS open,
                count(*) FILTER (WHERE due_at < now()) AS overdue,
                count(*) FILTER (WHERE due_at >= now() AND due_at < now() + make_interval(days => $1)) AS due_soon
           FROM privacy_request WHERE status = 'RECEIVED'`,
        [PRIVACY_REQUEST_DUE_SOON_DAYS],
      ),
    ]);
    return {
      items: list.rows.map((r) => this.queueItem(r, null, null)),
      counts: {
        open: Number(counts.rows[0]?.open ?? 0),
        overdue: Number(counts.rows[0]?.overdue ?? 0),
        dueSoon: Number(counts.rows[0]?.due_soon ?? 0),
      },
    };
  }

  /** 담당자가 요청 한 건을 연다 — 지원자가 쓴 내용을 풀어 보이고, 그 열람을 원서 체인에 남긴다 */
  async open(requestNumber: string, adminId: string): Promise<PrivacyQueueItem> {
    const number = this.number(requestNumber);
    return this.db.tx(async (client) => {
      const row = await this.queueRow(client, number);
      await this.audit.record(client, {
        applicationId: row.application_id,
        actorType: 'ADMIN',
        actorId: adminId,
        action: 'ADMIN_VIEWED_PII',
        result: 'ACCEPTED',
        details: { purpose: 'PRIVACY_REQUEST', requestNumber: number },
      });
      const { detail, resultNote } = await this.texts(client, row);
      return this.queueItem(row, detail, resultNote);
    });
  }

  /**
   * 결과를 한 번 회신한다. 일부 처리·거절은 사유를 알려야 한다(제35조 ⑤·제36조 ⑥·제37조 ③ — 열람 제한 사유에는
   * 공공기관의 "입학자 선발 업무에 중대한 지장"(제35조 ④ 3 나)이 있다). 회신은 지원자 화면에 그대로 보인다.
   */
  async decide(input: { requestNumber: string; outcome: string; note: unknown; adminId: string }): Promise<PrivacyQueueItem> {
    const number = this.number(input.requestNumber);
    if (!(PRIVACY_REQUEST_OUTCOME as readonly string[]).includes(input.outcome)) {
      throw ProblemException.validationFailed('처리 결과를 골라 주십시오.');
    }
    const outcome = input.outcome as PrivacyRequestOutcome;
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length === 0) throw ProblemException.validationFailed('지원자에게 보낼 결과 안내를 적어 주십시오.');
    if (note.length > PRIVACY_REQUEST_NOTE_MAX) {
      throw ProblemException.validationFailed(`결과 안내는 ${PRIVACY_REQUEST_NOTE_MAX}자 이내로 적어 주십시오.`);
    }
    if (outcome !== 'COMPLETED' && note.length < PRIVACY_REQUEST_REASON_MIN) {
      throw ProblemException.validationFailed('일부만 처리하거나 처리하지 않을 때는 그 사유를 지원자가 알 수 있게 적어 주십시오.');
    }

    return this.db.tx(async (client) => {
      const locked = await client.query<{ application_id: string; kind: string; status: string; late: boolean }>(
        `SELECT application_id, kind, status, due_at < now() AS late FROM privacy_request WHERE request_number = $1 FOR UPDATE`,
        [number],
      );
      const current = locked.rows[0];
      if (!current) throw ProblemException.notFound(NOT_FOUND);
      if (current.status !== 'RECEIVED') throw ProblemException.versionConflict('이미 회신한 요청입니다. 처리 큐를 새로 고쳐 주십시오.');

      const sealed = await sealField(client, current.application_id, `privacy:${number}:result`, note);
      await client.query(
        `UPDATE privacy_request SET status = $2, decided_at = now(), decided_by = $3, result_note_ciphertext = $4
          WHERE request_number = $1`,
        [number, outcome, input.adminId, sealed],
      );
      await this.audit.record(client, {
        applicationId: current.application_id,
        actorType: 'ADMIN',
        actorId: input.adminId,
        action: 'PRIVACY_REQUEST_DECIDED',
        result: 'ACCEPTED',
        details: { requestNumber: number, kind: current.kind, outcome, late: current.late },
      });
      const row = await this.queueRow(client, number);
      const { detail, resultNote } = await this.texts(client, row);
      return this.queueItem(row, detail, resultNote);
    });
  }

  private number(raw: string): string {
    const number = String(raw ?? '').trim().toUpperCase();
    if (!PRIVACY_REQUEST_NUMBER.test(number)) {
      throw ProblemException.validationFailed('요청번호 형식이 아닙니다. 번호를 다시 확인해 주십시오.');
    }
    return number;
  }

  private queueColumns(): string {
    return `${COLUMNS}, r.decided_by, s.application_number, a.support_code, a.status AS application_status,
            ((r.due_at AT TIME ZONE 'Asia/Seoul')::date - (now() AT TIME ZONE 'Asia/Seoul')::date) AS days_left,
            (r.status = 'RECEIVED' AND r.due_at < now()) AS overdue`;
  }

  private async queueRow(db: Queryable, number: string): Promise<QueueRow> {
    const { rows } = await db.query<QueueRow>(
      `SELECT ${this.queueColumns()}
         FROM privacy_request r
         JOIN application a ON a.id = r.application_id
         LEFT JOIN submission s ON s.application_id = r.application_id
        WHERE r.request_number = $1`,
      [number],
    );
    if (!rows[0]) throw ProblemException.notFound(NOT_FOUND);
    return rows[0];
  }

  private async texts(db: Queryable, row: Row): Promise<{ detail: string | null; resultNote: string | null }> {
    const cells = [
      ...(row.detail_ciphertext
        ? [{ field_code: `privacy:${row.request_number}:detail`, value_json: null, value_ciphertext: row.detail_ciphertext }]
        : []),
      ...(row.result_note_ciphertext
        ? [{ field_code: `privacy:${row.request_number}:result`, value_json: null, value_ciphertext: row.result_note_ciphertext }]
        : []),
    ];
    const opened = cells.length > 0 ? await openFields(db, row.application_id, cells) : {};
    const text = (key: string) => {
      const v = opened[`privacy:${row.request_number}:${key}`];
      return typeof v === 'string' ? v : null;
    };
    return { detail: text('detail'), resultNote: text('result') };
  }

  private async present(db: Queryable, row: Row): Promise<PrivacyRequestView> {
    const { detail, resultNote } = await this.texts(db, row);
    return {
      requestNumber: row.request_number,
      kind: row.kind,
      status: row.status,
      detail,
      receivedAt: row.received_at.toISOString(),
      dueAt: row.due_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
      resultNote,
    };
  }

  private queueItem(row: QueueRow, detail: string | null, resultNote: string | null): PrivacyQueueItem {
    return {
      requestNumber: row.request_number,
      kind: row.kind,
      status: row.status,
      detail,
      receivedAt: row.received_at.toISOString(),
      dueAt: row.due_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
      resultNote,
      applicationNumber: row.application_number,
      supportCode: row.support_code,
      applicationStatus: row.application_status,
      decidedBy: row.decided_by,
      daysLeft: Number(row.days_left),
      overdue: row.overdue,
    };
  }
}

function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i]! % 32];
  return out;
}
