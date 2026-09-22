import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';

export type Severity = 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
export type ExceptionState = 'OPEN' | 'AUTO_RESOLVED' | 'MANUAL_REVIEW' | 'RESOLVED';

export interface Finding {
  applicationId: string;
  type: string;
  severity: Severity;
  facts: Record<string, unknown>;
}

export interface ReconcileResult {
  checked: number;
  opened: number;
  autoResolved: number;
  stillOpen: number;
}

/** 중앙 ACK 를 기다려 주는 시간. 이 안에 안 오면 정상 지연이 아니라 문제로 본다. */
const CENTRAL_ACK_GRACE_MINUTES = 30;
/** 결제 UNKNOWN 을 방치할 수 있는 시간. */
const PAYMENT_UNKNOWN_GRACE_MINUTES = 30;

/**
 * Reconciliation Center — 기술설계서 v1.1 §A4·§B18·§C2 (T-M3-04)
 *
 * **Application · Payment · Submission · Central ACK 를 4-way 로 대조한다.**
 *
 * 왜 필요한가
 * Payment 와 Application 은 별도 Aggregate 다. (§A4)
 * 분리했기 때문에 정합성이 자동으로 맞지 않는다 — 그게 분리의 대가다.
 * PG callback 이 유실되거나 늦게 오면 "돈은 나갔는데 접수는 안 된" 상태가 생긴다.
 * 그 상태를 **사람이 발견하기 전에 시스템이 먼저 찾아내는 것**이 이 서비스의 일이다.
 *
 * 원칙
 *   1. **불일치만 큐로 보낸다.** (§B18) 정상 건을 목록에 올리면 신호가 묻힌다
 *   2. 자동으로 고치지 않는다. 발견하고 사람에게 넘긴다.
 *      돈과 접수 기회가 걸린 상태를 코드가 임의로 바꾸면 안 된다
 *   3. 해소된 건은 AUTO_RESOLVED 로 닫는다. 큐에 남겨두면 실제 문제가 묻힌다
 *   4. 보정은 Admin Action API 로만. reason·before/after 를 감사에 남긴다 (§B16)
 *
 * ⚠️ `(application_id, exception_type)` UNIQUE 가 DDL 에 없어 중복을 코드로 막는다.
 * 동시 실행에서는 여전히 중복이 가능하다. (불일치 대장 D-25)
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * 대조 1회 실행. D+1 배치와 수동 트리거가 같은 경로를 쓴다.
   * @param sinceHours 최근 몇 시간 내 원서를 볼 것인가. 전체 재검은 비싸다.
   */
  async reconcile(sinceHours = 48): Promise<ReconcileResult> {
    const findings = await this.detect(sinceHours);
    const byKey = new Set(findings.map((f) => `${f.applicationId}::${f.type}`));

    let opened = 0;
    for (const f of findings) {
      if (await this.openIfNew(f)) opened += 1;
    }

    // 더 이상 성립하지 않는 미해결 건을 닫는다.
    const autoResolved = await this.autoResolveStale(byKey, sinceHours);

    const stillOpen = await this.countOpen();
    const result = { checked: findings.length, opened, autoResolved, stillOpen };

    if (opened > 0 || autoResolved > 0) {
      this.logger.warn(
        `reconcile: opened=${opened} autoResolved=${autoResolved} stillOpen=${stillOpen}`,
      );
    }
    return result;
  }

  /** 4-way 대조. 각 검사는 "무엇이 어긋났는가" 를 facts 에 담는다. */
  async detect(sinceHours: number): Promise<Finding[]> {
    const since = `${sinceHours} hours`;
    const findings: Finding[] = [];

    // 1. 결제는 확인됐는데 접수 기록이 없다.
    //    **가장 심각하다.** 지원자는 돈을 냈고 접수됐다고 믿는다.
    findings.push(
      ...(await this.query(
        `SELECT p.application_id, p.id AS payment_id, p.amount, p.verified_at
           FROM payment p
           LEFT JOIN submission s ON s.application_id = p.application_id
          WHERE p.status = 'CONFIRMED'
            AND s.id IS NULL
            AND p.verified_at > now() - $1::interval`,
        [since],
        'PAYMENT_CONFIRMED_WITHOUT_SUBMISSION',
        'CRITICAL',
      )),
    );

    // 2. 접수됐는데 확인된 결제가 없다. 무상 접수이거나 결제 기록이 사라진 것이다.
    findings.push(
      ...(await this.query(
        `SELECT s.application_id, s.application_number, s.finalized_at
           FROM submission s
          WHERE s.finalized_at > now() - $1::interval
            AND NOT EXISTS (
              SELECT 1 FROM payment p
               WHERE p.application_id = s.application_id AND p.status = 'CONFIRMED'
            )`,
        [since],
        'SUBMISSION_WITHOUT_CONFIRMED_PAYMENT',
        'CRITICAL',
      )),
    );

    // 3. 상태는 FINALIZED 인데 Submission 행이 없다.
    //    같은 트랜잭션에서 쓰므로 정상적으로는 불가능하다. 나오면 DB 손상이다.
    findings.push(
      ...(await this.query(
        `SELECT a.id AS application_id, a.status, a.updated_at
           FROM application a
           LEFT JOIN submission s ON s.application_id = a.id
          WHERE a.status = 'FINALIZED'
            AND s.id IS NULL
            AND a.updated_at > now() - $1::interval`,
        [since],
        'FINALIZED_WITHOUT_SUBMISSION',
        'CRITICAL',
      )),
    );

    // 4. Submission 은 있는데 상태가 FINALIZED 가 아니다.
    findings.push(
      ...(await this.query(
        `SELECT s.application_id, a.status, s.application_number
           FROM submission s
           JOIN application a ON a.id = s.application_id
          WHERE a.status <> 'FINALIZED'
            AND s.finalized_at > now() - $1::interval`,
        [since],
        'SUBMISSION_WITHOUT_FINALIZED_STATUS',
        'CRITICAL',
      )),
    );

    // 5. 중앙 ACK 가 오지 않았다.
    //    **접수 실패가 아니다.** 통합 조회 반영만 늦는다. 그래서 HIGH 지 CRITICAL 이 아니다.
    findings.push(
      ...(await this.query(
        `SELECT o.aggregate_id AS application_id, o.status, o.attempt_count, o.created_at
           FROM outbox_event o
          WHERE o.status IN ('PENDING','SENDING')
            AND o.created_at < now() - ($1 || ' minutes')::interval
            AND o.created_at > now() - $2::interval`,
        [String(CENTRAL_ACK_GRACE_MINUTES), since],
        'CENTRAL_ACK_MISSING',
        'HIGH',
      )),
    );

    // 6. 재시도 한도를 넘겨 버려진 이벤트. 사람이 봐야 한다.
    findings.push(
      ...(await this.query(
        `SELECT o.aggregate_id AS application_id, o.event_type, o.attempt_count
           FROM outbox_event o
          WHERE o.status = 'DEAD' AND o.created_at > now() - $1::interval`,
        [since],
        'OUTBOX_DEAD_LETTER',
        'HIGH',
      )),
    );

    // 7. 결제 상태를 확인하지 못한 채 방치됐다.
    //    사용자에게는 "확인 중" 으로 보인다. 오래 두면 재결제 문의가 몰린다. (§B4)
    findings.push(
      ...(await this.query(
        `SELECT p.application_id, p.id AS payment_id, p.updated_at
           FROM payment p
          WHERE p.status = 'UNKNOWN'
            AND p.updated_at < now() - ($1 || ' minutes')::interval
            AND p.updated_at > now() - $2::interval`,
        [String(PAYMENT_UNKNOWN_GRACE_MINUTES), since],
        'PAYMENT_STATE_UNKNOWN_STALE',
        'HIGH',
      )),
    );

    return findings;
  }

  async list(state: ExceptionState | 'ALL' = 'OPEN'): Promise<
    Array<{
      id: string;
      applicationId: string;
      exceptionType: string;
      severity: Severity;
      state: ExceptionState;
      facts: Record<string, unknown>;
      detectedAt: string;
    }>
  > {
    const where = state === 'ALL' ? '' : `WHERE state = '${state}'`;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, application_id, exception_type, severity, state, facts, detected_at
         FROM reconciliation_exception
         ${where}
        ORDER BY
          CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
          detected_at DESC
        LIMIT 200`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      applicationId: String(r.application_id),
      exceptionType: String(r.exception_type),
      severity: r.severity as Severity,
      state: r.state as ExceptionState,
      facts: r.facts as Record<string, unknown>,
      detectedAt: (r.detected_at as Date).toISOString(),
    }));
  }

  /**
   * 수동 해소. (§B16)
   * **사유가 필수다.** 누가 왜 닫았는지가 남지 않으면 보정 자체가 증적이 안 된다.
   * 여기서 상태를 고치지는 않는다 — 판단만 기록한다.
   */
  async resolve(
    exceptionId: string,
    resolvedBy: string,
    resolutionCode: string,
    reason: string,
  ): Promise<{ id: string; state: ExceptionState }> {
    if (!resolutionCode.trim() || !reason.trim()) {
      throw ProblemException.validationFailed('처리 코드와 사유를 모두 입력해야 합니다.');
    }

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT application_id, exception_type, severity, state
         FROM reconciliation_exception WHERE id = $1`,
      [exceptionId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 예외 항목입니다.');

    const before = String(r.state);
    if (before === 'RESOLVED' || before === 'AUTO_RESOLVED') {
      throw ProblemException.validationFailed(`이미 처리된 항목입니다. (${before})`);
    }

    await this.db.tx(async (client) => {
      await client.query(
        `UPDATE reconciliation_exception
            SET state = 'RESOLVED', resolved_at = now(),
                resolution_code = $2, resolved_by = $3
          WHERE id = $1`,
        [exceptionId, resolutionCode, resolvedBy],
      );

      // before/after 를 함께 남긴다. (§B16)
      await this.audit.record(client, {
        applicationId: String(r.application_id),
        actorType: 'ADMIN',
        actorId: resolvedBy,
        action: 'ADMIN_CHANGED_CONFIG',
        result: 'ACCEPTED',
        details: {
          purpose: 'RECONCILIATION_RESOLVE',
          exceptionId,
          exceptionType: String(r.exception_type),
          before,
          after: 'RESOLVED',
          resolutionCode,
          reason,
        },
      });
    });

    this.logger.log(`exception ${exceptionId} resolved by ${resolvedBy} (${resolutionCode})`);
    return { id: exceptionId, state: 'RESOLVED' };
  }

  /* ── 내부 ────────────────────────────────────────────────────────── */

  private async query(
    sql: string,
    params: unknown[],
    type: string,
    severity: Severity,
  ): Promise<Finding[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(sql, params);
    return rows.map((r) => {
      const { application_id: applicationId, ...facts } = r;
      return {
        applicationId: String(applicationId),
        type,
        severity,
        facts: normalize(facts),
      };
    });
  }

  /** 이미 열려 있는 같은 종류의 건이면 새로 만들지 않는다. (D-25 우회) */
  private async openIfNew(f: Finding): Promise<boolean> {
    const existing = await this.db.query(
      `SELECT 1 FROM reconciliation_exception
        WHERE application_id = $1 AND exception_type = $2
          AND state IN ('OPEN','MANUAL_REVIEW')
        LIMIT 1`,
      [f.applicationId, f.type],
    );
    if ((existing.rowCount ?? 0) > 0) return false;

    await this.db.query(
      `INSERT INTO reconciliation_exception
         (id, application_id, exception_type, severity, state, facts)
       VALUES ($1,$2,$3,$4,'OPEN',$5)`,
      [randomUUID(), f.applicationId, f.type, f.severity, JSON.stringify(f.facts)],
    );
    this.logger.warn(`${f.severity} ${f.type} application=${f.applicationId}`);
    return true;
  }

  /**
   * 더 이상 성립하지 않는 미해결 건을 닫는다.
   * 늦게 도착한 PG callback 이나 중앙 ACK 로 저절로 풀리는 경우가 실제로 많다.
   */
  private async autoResolveStale(
    currentKeys: Set<string>,
    sinceHours: number,
  ): Promise<number> {
    const { rows } = await this.db.query<{ id: string; application_id: string; exception_type: string }>(
      `SELECT id, application_id, exception_type
         FROM reconciliation_exception
        WHERE state = 'OPEN' AND detected_at > now() - ($1 || ' hours')::interval`,
      [String(sinceHours)],
    );

    let closed = 0;
    for (const r of rows) {
      if (currentKeys.has(`${r.application_id}::${r.exception_type}`)) continue;
      await this.db.query(
        `UPDATE reconciliation_exception
            SET state = 'AUTO_RESOLVED', resolved_at = now(),
                resolution_code = 'SELF_HEALED'
          WHERE id = $1 AND state = 'OPEN'`,
        [r.id],
      );
      closed += 1;
    }
    return closed;
  }

  private async countOpen(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM reconciliation_exception
        WHERE state IN ('OPEN','MANUAL_REVIEW')`,
    );
    return Number(rows[0]?.n ?? 0);
  }
}

/** Date 를 ISO 로 바꿔 facts 를 JSON 으로 안전하게 만든다. */
function normalize(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
