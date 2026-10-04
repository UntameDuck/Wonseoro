import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  AUDIT_ACTION_LABEL,
  labelOf,
  normalizeSupportCode,
  SUPPORT_EVIDENCE_NUMBER,
  SUPPORT_REASON,
  type SupportLookupKind,
  type SupportReason,
} from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { canonicalJson } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
import { DeadlineService } from '../deadline/deadline.service';
import { IncidentService } from '../incident/incident.service';
import { applicationSummary, centralSyncGuidance, paymentGuidance } from '../meta/status-summary';

/**
 * 상담원이 보는 원서 상태 — **허용 목록으로만 만든다** (노션 §01 B11, D-79).
 *
 * 싣지 않는 것: 원서 항목 값·공통원서·서류 종류와 파일 이름·이름/연락처·지원자/원서/결제/제출 식별자·
 * 결제사 거래번호·전형/모집단위(지원 내용 자체). 화면에서 숨기는 것이 아니라 여기서 아예 만들지 않는다.
 * 새 필드를 더하려면 대장 D-79 의 허용 목록부터 고친다 — `support.integration.test` 가 키 전수를 본다.
 */
export interface SupportView {
  evidenceNumber: string;
  lookedUpAt: string;
  reason: SupportReason;
  lookupKind: SupportLookupKind;
  universityName: string;
  cycleName: string;
  application: { status: string; summary: string; lastSavedAt: string | null };
  submission: { submitted: boolean; applicationNumber: string | null; finalizedAt: string | null };
  payment: {
    status: string | null;
    amount: number | null;
    requestedAt: string | null;
    verifiedAt: string | null;
    guidance: string;
  };
  /** 서류는 상태별 개수만 — 종류·파일 이름은 원서 내용이다 */
  documents: { available: number; scanning: number; rejected: number; uploading: number };
  centralSync: { pending: number; sent: number; lastSentAt: string | null; guidance: string };
  deadline: { deadlineAt: string | null };
  incidents: Array<{ severity: string; title: string; startsAt: string }>;
  /** 처리 이력 — 무엇을 언제 했는지. 누가 했는지(담당자·IP)는 싣지 않는다 */
  timeline: Array<{ at: string; what: string; result: string }>;
  /** 상담원이 지원자에게 할 말 */
  agentGuidance: string[];
}

export interface SupportRecord extends SupportView {
  snapshotHash: string;
  /** 저장된 내용을 다시 해시해 같은지 — 기록이 그대로임을 보인다 */
  intact: boolean;
}

type Draft = Omit<SupportView, 'evidenceNumber' | 'lookedUpAt' | 'reason' | 'lookupKind'>;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NOT_FOUND = '이 번호로 찾은 원서가 없습니다. 번호를 다시 확인해 주십시오.';

@Injectable()
export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly deadline: DeadlineService,
    private readonly incidents: IncidentService,
  ) {}

  /** 접수번호 또는 상담 확인번호로 찾아 보이고, 증적번호와 함께 그 순간을 남긴다 */
  async lookup(input: { key: string; reason: string; agentId: string }): Promise<SupportView> {
    if (!(SUPPORT_REASON as readonly string[]).includes(input.reason)) {
      throw ProblemException.validationFailed('문의 분류를 선택해 주십시오.');
    }
    const key = input.key.trim();
    if (!key || key.length > 80) {
      throw ProblemException.validationFailed('접수번호나 상담 확인번호를 적어 주십시오.');
    }
    const found = await this.find(key);
    // 접수번호와 상담 확인번호 어느 쪽이 틀려도 같은 답이다 — 어느 키가 맞았는지 단서를 주지 않는다
    if (!found) throw ProblemException.notFound(NOT_FOUND);

    const draft = await this.draft(found.applicationId, found.cycleId);
    const reason = input.reason as SupportReason;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.tx(async (client) => {
          // 조회 시각·증적번호의 날짜는 DB 시계다(§A2) — 날짜는 한국 날짜
          const { rows } = await client.query<{ at: Date; day: string }>(
            `SELECT now() AS at, to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') AS day`,
          );
          const evidenceNumber = `SR-${rows[0]!.day}-${randomCrockford(6)}`;
          const view: SupportView = {
            evidenceNumber,
            lookedUpAt: rows[0]!.at.toISOString(),
            reason,
            lookupKind: found.kind,
            ...draft,
          };
          const snapshotHash = sha256(canonicalJson(view));
          await client.query(
            `INSERT INTO support_lookup
               (evidence_number, application_id, lookup_kind, reason, agent_id, looked_up_at, snapshot, snapshot_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [evidenceNumber, found.applicationId, found.kind, reason, input.agentId, rows[0]!.at, view, snapshotHash],
          );
          // 원서 체인에 잇는다 — 지원자 상태 확인의 처리 이력에 "상담 조회" 로 보인다
          await this.audit.record(client, {
            applicationId: found.applicationId,
            actorType: 'ADMIN',
            actorId: input.agentId,
            action: 'SUPPORT_LOOKUP',
            result: 'ACCEPTED',
            details: { evidenceNumber, reason, lookupKind: found.kind, snapshotHash },
          });
          return view;
        });
      } catch (err) {
        // 같은 날 같은 6자(2^30 중 하나)가 겹치면 새 번호로 다시
        const e = err as { code?: string; constraint?: string };
        if (attempt < 2 && e?.code === '23505' && e.constraint === 'support_lookup_pkey') continue;
        throw err;
      }
    }
  }

  /** 증적번호로 그때 안내한 내용을 그대로 다시 연다 */
  async reopen(evidenceNumber: string): Promise<SupportRecord> {
    const number = evidenceNumber.trim().toUpperCase();
    if (!SUPPORT_EVIDENCE_NUMBER.test(number)) {
      throw ProblemException.validationFailed('증적번호 형식이 아닙니다. 번호를 다시 확인해 주십시오.');
    }
    const { rows } = await this.db.query<{ snapshot: SupportView; snapshot_hash: string }>(
      `SELECT snapshot, snapshot_hash FROM support_lookup WHERE evidence_number = $1`,
      [number],
    );
    const row = rows[0];
    if (!row) throw ProblemException.notFound('이 증적번호로 남은 상담 기록이 없습니다.');
    return {
      ...row.snapshot,
      snapshotHash: row.snapshot_hash,
      intact: sha256(canonicalJson(row.snapshot)) === row.snapshot_hash,
    };
  }

  private async find(key: string): Promise<{ applicationId: string; cycleId: string; kind: SupportLookupKind } | null> {
    const byNumber = await this.db.query<{ id: string; cycle_id: string }>(
      `SELECT a.id, a.cycle_id
         FROM submission s JOIN application a ON a.id = s.application_id
        WHERE upper(s.application_number) = upper($1)`,
      [key],
    );
    if (byNumber.rows[0]) {
      return { applicationId: byNumber.rows[0].id, cycleId: byNumber.rows[0].cycle_id, kind: 'APPLICATION_NUMBER' };
    }
    const code = normalizeSupportCode(key);
    if (!code) return null;
    const byCode = await this.db.query<{ id: string; cycle_id: string }>(
      `SELECT id, cycle_id FROM application WHERE support_code = $1`,
      [code],
    );
    const row = byCode.rows[0];
    return row ? { applicationId: row.id, cycleId: row.cycle_id, kind: 'SUPPORT_CODE' } : null;
  }

  private async draft(applicationId: string, cycleId: string): Promise<Draft> {
    const [head, payment, submission, documents, central, timeline, deadlineAt, incidents] = await Promise.all([
      this.db.query<{ status: string; last_saved_at: Date | null; cycle_name: string; university_name: string }>(
        `SELECT a.status, a.last_saved_at, c.name AS cycle_name, u.name AS university_name
           FROM application a
           JOIN admission_cycle c ON c.id = a.cycle_id
           JOIN university u ON u.id = c.university_id
          WHERE a.id = $1`,
        [applicationId],
      ),
      this.db.query<{ status: string; amount: string; created_at: Date; verified_at: Date | null }>(
        `SELECT status, amount, created_at, verified_at FROM payment
          WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [applicationId],
      ),
      this.db.query<{ application_number: string; finalized_at: Date }>(
        `SELECT application_number, finalized_at FROM submission WHERE application_id = $1`,
        [applicationId],
      ),
      this.db.query<{ status: string; n: string }>(
        `SELECT status, count(*) AS n FROM document
          WHERE application_id = $1 AND status <> 'DELETED' GROUP BY status`,
        [applicationId],
      ),
      this.db.query<{ pending: string; sent: string; last_sent_at: Date | null }>(
        // 보관 표로 옮긴 이벤트(T-M4-10)도 보낸 것으로 센다 — 지원자 상태 확인과 같은 셈
        `SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING')) AS pending,
                count(*) FILTER (WHERE status = 'SENT')
                  + (SELECT count(*) FROM outbox_event_archive WHERE aggregate_id = $1) AS sent,
                max(sent_at) AS last_sent_at
           FROM outbox_event WHERE aggregate_id = $1`,
        [applicationId],
      ),
      this.db.query<{ occurred_at: Date; action: string; result: string }>(
        `SELECT occurred_at, action, result FROM audit_event
          WHERE application_id = $1 ORDER BY occurred_at ASC LIMIT 200`,
        [applicationId],
      ),
      // 마감 정책이 아직 없는 모집이어도 상담은 된다 — 마감 시각만 비운다
      this.deadline.snapshot(cycleId).then((s) => s.deadlineAt, () => null),
      this.incidents.list('ACTIVE'),
    ]);

    const app = head.rows[0];
    if (!app) throw ProblemException.notFound(NOT_FOUND);
    const pay = payment.rows[0];
    const sub = submission.rows[0];
    const docCount = (s: string) => Number(documents.rows.find((r) => r.status === s)?.n ?? 0);
    const pending = Number(central.rows[0]?.pending ?? 0);

    const draft: Draft = {
      universityName: app.university_name,
      cycleName: app.cycle_name,
      application: {
        status: app.status,
        summary: applicationSummary(app.status, sub !== undefined),
        lastSavedAt: app.last_saved_at?.toISOString() ?? null,
      },
      submission: {
        submitted: sub !== undefined,
        applicationNumber: sub?.application_number ?? null,
        finalizedAt: sub?.finalized_at.toISOString() ?? null,
      },
      payment: {
        status: pay?.status ?? null,
        amount: pay ? Number(pay.amount) : null,
        requestedAt: pay?.created_at.toISOString() ?? null,
        verifiedAt: pay?.verified_at?.toISOString() ?? null,
        guidance: paymentGuidance(pay?.status ?? null),
      },
      documents: {
        available: docCount('AVAILABLE'),
        scanning: docCount('QUARANTINED'),
        rejected: docCount('REJECTED'),
        uploading: docCount('UPLOADING'),
      },
      centralSync: {
        pending,
        sent: Number(central.rows[0]?.sent ?? 0),
        lastSentAt: central.rows[0]?.last_sent_at?.toISOString() ?? null,
        guidance: centralSyncGuidance(pending),
      },
      deadline: { deadlineAt },
      incidents: incidents.map((i) => ({ severity: i.severity, title: i.title, startsAt: i.startsAt })),
      timeline: timeline.rows.map((r) => ({
        at: r.occurred_at.toISOString(),
        what: labelOf(AUDIT_ACTION_LABEL, r.action),
        result: r.result,
      })),
      agentGuidance: [],
    };
    draft.agentGuidance = guidanceFor(draft);
    return draft;
  }
}

/** 상담원이 지원자에게 할 말 — 상태에서만 나온다. 재결제를 권하지 않는다(§B4) */
function guidanceFor(d: Draft): string[] {
  const out: string[] = [];
  if (d.submission.submitted) {
    out.push('접수가 완료되었습니다. 다시 결제하거나 다시 제출할 필요가 없다고 안내해 주십시오.');
    if (d.centralSync.pending > 0) {
      out.push('통합 조회 화면 반영만 늦어지고 있습니다. 접수에는 영향이 없다고 안내해 주십시오.');
    }
  } else if (d.payment.status === 'PENDING' || d.payment.status === 'UNKNOWN') {
    out.push('결제를 확인하는 중입니다. 다시 결제하지 말고 잠시 뒤 상태를 다시 확인하도록 안내해 주십시오.');
  } else if (d.application.status === 'PAID' || d.application.status === 'FINALIZING') {
    out.push('결제가 확인되어 접수가 자동으로 진행됩니다. 다시 결제하지 않도록 안내해 주십시오.');
  } else if (d.application.status === 'DRAFT' || d.application.status === 'READY') {
    out.push('아직 접수되지 않았습니다. 마감 전에 결제까지 마쳐야 접수된다고 안내해 주십시오.');
  }
  if (d.documents.rejected > 0) {
    out.push('검사를 통과하지 못한 서류가 있습니다. 지원자가 다시 올리도록 안내해 주십시오.');
  }
  if (d.incidents.length > 0) {
    out.push('지금 장애 공지가 있습니다. 공지 내용을 함께 안내해 주십시오.');
  }
  out.push('원서 내용과 개인정보는 상담으로 확인하거나 바꿀 수 없습니다. 지원자 본인이 화면에서 확인하도록 안내해 주십시오.');
  return out;
}

function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
