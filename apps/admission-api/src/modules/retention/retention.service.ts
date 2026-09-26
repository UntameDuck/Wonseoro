import { Injectable } from '@nestjs/common';
import {
  RETENTION_CATEGORIES,
  RetentionCategory,
  RetentionCategoryCode,
  RetentionPolicy,
  RetentionProblem,
  validateRetention,
} from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';

const DAY_MS = 86_400_000;

export type RetentionStatus =
  /** 보존정책에 항목이 없다. 파기 대상이 아니다. */
  | 'UNSET'
  /** 보존기간이 아직 남았다. */
  | 'RETAINED'
  /** 보존기간이 지났다. 파기 대상이다. */
  | 'DUE'
  /** 기간이 지났지만 감사 체인 안에 있어 지울 수 없다. WORM 이관 뒤에 다룬다. */
  | 'DUE_BUT_CHAINED'
  /** 보존기간을 정할 수 없는 기록. */
  | 'IMMUTABLE';

export interface RetentionPlanItem {
  code: RetentionCategoryCode;
  label: string;
  floor: RetentionCategory['floor'];
  purge: RetentionCategory['purge'];
  days: number | null;
  dueAt: string | null;
  status: RetentionStatus;
  /** DUE 일 때만 센다. 보존 중인 데이터의 양은 여기서 알 필요가 없다. */
  affected: number | null;
}

/**
 * 파기 계획 — v1.1 §A15 (T-M3-10)
 *
 * **계획만 보여준다. 지우지 않는다.**
 * 파기는 되돌릴 수 없다. 지우는 코드는 WORM 이관(M5)과 함께, 그리고 이 계획을
 * 사람이 읽고 승인하는 절차와 함께 붙인다. 계획 없이 지우는 코드부터 만들면
 * 보존정책의 오타 하나가 한 해 입시 기록을 지운다.
 *
 * 원서 "파기" 는 행 삭제가 아니라 **내용 제거**다. 감사 체인이 원서 행을 참조하고
 * (audit_event.application_id, CASCADE 없음), 원서를 지우면 동의 기록이 함께
 * 지워진다(consent_record ON DELETE CASCADE). 행을 지우는 순간 증적이 깨진다. (D-38)
 */
@Injectable()
export class RetentionService {
  constructor(private readonly db: Db) {}

  async plan(cycleId: string): Promise<{
    cycleId: string;
    cycleClosesAt: string;
    configVersion: string | null;
    configured: boolean;
    /** 적용 중인 정책이 지금 기준에 맞는가. 법정 기준이 올라가면 맞지 않을 수 있다. */
    problems: RetentionProblem[];
    items: RetentionPlanItem[];
    executes: false;
    generatedAt: string;
  }> {
    const { rows: cyc } = await this.db.query<{ closes_at: Date }>(
      `SELECT closes_at FROM admission_cycle WHERE id = $1`,
      [cycleId],
    );
    if (!cyc[0]) throw ProblemException.validationFailed('존재하지 않는 모집입니다.');
    const closesAt = cyc[0].closes_at;

    const { rows: cfg } = await this.db.query<{ version: string; config_json: Record<string, unknown> }>(
      `SELECT version, config_json FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE'`,
      [cycleId],
    );
    const policy = cfg[0]?.config_json?.retention as RetentionPolicy | undefined;
    const now = Date.now();

    const items: RetentionPlanItem[] = [];
    for (const code of Object.keys(RETENTION_CATEGORIES) as RetentionCategoryCode[]) {
      const cat: RetentionCategory = RETENTION_CATEGORIES[code];
      const base = { code, label: cat.label, floor: cat.floor, purge: cat.purge };

      if (cat.floor.kind === 'IMMUTABLE') {
        items.push({ ...base, days: null, dueAt: null, status: 'IMMUTABLE', affected: null });
        continue;
      }
      const days = policy?.[code]?.days;
      if (typeof days !== 'number') {
        items.push({ ...base, days: null, dueAt: null, status: 'UNSET', affected: null });
        continue;
      }

      if (cat.anchor === 'EVENT_TIME') {
        // 사건 단위. "기간이 지난 기록이 몇 건인가" 를 센다.
        const before = new Date(now - days * DAY_MS);
        const affected = await this.countEvents(code, before);
        items.push({
          ...base,
          days,
          dueAt: null,
          status: affected > 0 ? (cat.purge === 'NONE' ? 'DUE_BUT_CHAINED' : 'DUE') : 'RETAINED',
          affected: affected > 0 ? affected : null,
        });
        continue;
      }

      const dueAt = new Date(closesAt.getTime() + days * DAY_MS);
      const due = now >= dueAt.getTime();
      items.push({
        ...base,
        days,
        dueAt: dueAt.toISOString(),
        status: due ? 'DUE' : 'RETAINED',
        affected: due ? await this.countInCycle(code, cycleId) : null,
      });
    }

    return {
      cycleId,
      cycleClosesAt: closesAt.toISOString(),
      configVersion: cfg[0]?.version ?? null,
      configured: policy !== undefined,
      problems: policy === undefined ? [] : validateRetention(policy),
      items,
      executes: false,
      generatedAt: new Date(now).toISOString(),
    };
  }

  private async countInCycle(code: RetentionCategoryCode, cycleId: string): Promise<number> {
    const sql: Partial<Record<RetentionCategoryCode, string>> = {
      APPLICATION_UNSUBMITTED: `SELECT count(*) AS n FROM application
                                 WHERE cycle_id = $1 AND status <> 'FINALIZED'`,
      APPLICATION_SUBMITTED: `SELECT count(*) AS n FROM application
                               WHERE cycle_id = $1 AND status = 'FINALIZED'`,
      // 다른 모집에도 원서가 있는 지원자의 신원은 이 모집 때문에 지울 수 없다.
      APPLICANT_PII: `SELECT count(DISTINCT a.applicant_id) AS n FROM application a
                       WHERE a.cycle_id = $1
                         AND NOT EXISTS (SELECT 1 FROM application o
                                          WHERE o.applicant_id = a.applicant_id
                                            AND o.cycle_id <> $1)`,
      DOCUMENT_FILE: `SELECT count(*) AS n FROM document d JOIN application a ON a.id = d.application_id
                       WHERE a.cycle_id = $1 AND d.status <> 'DELETED'`,
      PAYMENT_RECORD: `SELECT count(*) AS n FROM payment p JOIN application a ON a.id = p.application_id
                        WHERE a.cycle_id = $1`,
      CONSENT_RECORD: `SELECT count(*) AS n FROM consent_record c JOIN application a ON a.id = c.application_id
                        WHERE a.cycle_id = $1`,
    };
    const q = sql[code];
    if (!q) return 0;
    const { rows } = await this.db.query<{ n: string }>(q, [cycleId]);
    return Number(rows[0]?.n ?? 0);
  }

  private async countEvents(code: RetentionCategoryCode, before: Date): Promise<number> {
    if (code !== 'ADMIN_ACCESS_LOG') return 0;
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_event
        WHERE action = 'ADMIN_VIEWED_PII' AND occurred_at < $1`,
      [before],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
