import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DeadlineMode, DeadlinePolicy } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import {
  addApproval,
  assertActivationTime,
  assertApproved,
} from '../config/two-person-rule';
import { DeadlinePolicyPort } from './deadline-policy.port';

/**
 * Deadline Policy Engine — 기술설계서 v1.1 §A2·§A14 (T-M3-01)
 *
 * M1 의 환경변수 구현을 대체한다. 이제 마감 판정의 근거는
 * **DB 에 승인·활성화 기록이 남은 정책 버전**이다.
 *
 * 설계 원칙
 *   1. 활성화된 정책이 없으면 **마감을 판정하지 않는다.** 추측하지 않는다
 *   2. 정책은 불변이다. 바꾸려면 새 버전을 만들고 다시 승인받는다
 *   3. 활성화 이력이 남는다. "누가 언제 마감을 바꿨는가"에 답할 수 있어야 한다
 *   4. 2인 승인 없이는 활성화되지 않는다. DB CHECK 가 함께 막는다
 */
@Injectable()
export class DeadlinePolicyRepository extends DeadlinePolicyPort {
  private readonly logger = new Logger(DeadlinePolicyRepository.name);

  constructor(private readonly db: Db) {
    super();
  }

  /**
   * 현재 적용되는 정책.
   *
   * 활성화 시각이 이미 지난 것 중 가장 최근 것을 쓴다.
   * 예약 활성화(미래 시각)는 아직 적용되지 않는다. (§A14)
   */
  async current(admissionCycleId: string): Promise<DeadlinePolicy> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT version, mode, deadline_at, approved_by_1, approved_by_2,
              approved_at, activated_at, policy_hash
         FROM deadline_policy
        WHERE cycle_id = $1
          AND activated_at IS NOT NULL
          AND activated_at <= now()
        ORDER BY activated_at DESC
        LIMIT 1`,
      [admissionCycleId],
    );

    const r = rows[0];
    if (r) return this.toPolicy(r);

    // 개발 편의용 대체 경로. 운영에서는 열어두지 않는다.
    // 활성 정책 없이 마감을 판정하면 그 판정의 근거가 남지 않는다.
    if (process.env.ALLOW_ENV_DEADLINE_POLICY === 'true') {
      return this.envPolicy(admissionCycleId);
    }

    this.logger.error(`no active deadline policy for cycle ${admissionCycleId}`);
    throw ProblemException.retryable(
      '활성화된 마감 정책이 없어 요청을 처리할 수 없습니다. 입학처에 문의해 주십시오.',
    );
  }

  /** 정책 초안 생성. 이 시점에는 아직 아무 효력이 없다. */
  async createDraft(input: {
    cycleId: string;
    version: string;
    mode: DeadlineMode;
    deadlineAt: string;
    createdBy: string;
  }): Promise<{ policyId: string; policyHash: string }> {
    const policyId = randomUUID();
    const snapshot = {
      cycleId: input.cycleId,
      version: input.version,
      mode: input.mode,
      deadlineAt: input.deadlineAt,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    const policyHash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');

    /**
     * ⚠️ DDL 이 approved_by_1/2 와 approved_at 을 NOT NULL 로 잡고 있어
     * 초안 상태를 표현할 수 없다. 작성자 표식을 넣어 "미승인"을 나타낸다.
     * 승인이 들어오면 실제 승인자로 덮어쓴다.
     *
     * 더 깔끔한 방법은 status 컬럼을 두는 것이다 — config_version 처럼.
     * 노션 §02 에 제안해야 한다.
     */
    await this.db.query(
      `INSERT INTO deadline_policy
         (id, cycle_id, version, mode, deadline_at,
          approved_by_1, approved_by_2, approved_at, activated_at,
          policy_hash, immutable_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),NULL,$8,$9)`,
      [
        policyId,
        input.cycleId,
        input.version,
        input.mode,
        input.deadlineAt,
        `DRAFT:${input.createdBy}`,
        `DRAFT:pending`,
        policyHash,
        JSON.stringify(snapshot),
      ],
    );

    return { policyId, policyHash };
  }

  async approve(policyId: string, approver: string): Promise<{ complete: boolean }> {
    const state = await this.loadApprovalState(policyId);
    const result = addApproval(state, approver);

    await this.db.query(
      `UPDATE deadline_policy
          SET approved_by_1 = $2,
              approved_by_2 = COALESCE($3, 'DRAFT:pending'),
              approved_at = now()
        WHERE id = $1`,
      [policyId, result.approvedBy1, result.approvedBy2],
    );

    this.logger.log(
      `deadline policy ${policyId} approved by ${approver} (complete=${result.complete})`,
    );
    return { complete: result.complete };
  }

  /**
   * 활성화. 이 시점부터 마감 판정에 쓰인다. (D-22 — 계약에 없던 경로)
   * 예약 시각을 주면 그때부터 적용된다.
   */
  async activate(policyId: string, activateAt: Date | null): Promise<{ activatedAt: string }> {
    const state = await this.loadApprovalState(policyId);
    assertApproved(state);
    assertActivationTime(activateAt);

    const at = activateAt ?? new Date();
    await this.db.query(`UPDATE deadline_policy SET activated_at = $2 WHERE id = $1`, [
      policyId,
      at,
    ]);

    this.logger.log(`deadline policy ${policyId} activated at ${at.toISOString()}`);
    return { activatedAt: at.toISOString() };
  }

  /** 정책 이력. "누가 언제 마감을 바꿨는가"에 답한다. */
  async history(cycleId: string): Promise<
    Array<{
      policyId: string;
      version: string;
      mode: string;
      deadlineAt: string;
      approvedBy: string[];
      activatedAt: string | null;
      policyHash: string;
    }>
  > {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, version, mode, deadline_at, approved_by_1, approved_by_2,
              activated_at, policy_hash
         FROM deadline_policy
        WHERE cycle_id = $1
        -- ⚠️ deadline_policy 에는 created_at 이 없다. (D-23)
        -- 생성 순서를 알 수 없어 승인 시각으로 정렬한다.
        ORDER BY approved_at DESC NULLS LAST, version DESC`,
      [cycleId],
    );
    return rows.map((r) => ({
      policyId: String(r.id),
      version: String(r.version),
      mode: String(r.mode),
      deadlineAt: (r.deadline_at as Date).toISOString(),
      approvedBy: [String(r.approved_by_1), String(r.approved_by_2)].filter(
        (a) => !a.startsWith('DRAFT:'),
      ),
      activatedAt: r.activated_at ? (r.activated_at as Date).toISOString() : null,
      policyHash: String(r.policy_hash),
    }));
  }

  private async loadApprovalState(policyId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT approved_by_1, approved_by_2, immutable_snapshot
         FROM deadline_policy WHERE id = $1`,
      [policyId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 마감 정책입니다.');

    const a1 = String(r.approved_by_1);
    const a2 = String(r.approved_by_2);
    const snapshot = r.immutable_snapshot as { createdBy?: string };

    return {
      createdBy: snapshot?.createdBy ?? '',
      approvedBy1: a1.startsWith('DRAFT:') ? null : a1,
      approvedBy2: a2.startsWith('DRAFT:') ? null : a2,
    };
  }

  private toPolicy(r: Record<string, unknown>): DeadlinePolicy {
    return {
      version: String(r.version),
      mode: r.mode as DeadlineMode,
      deadlineAt: (r.deadline_at as Date).toISOString(),
      approvedBy1: String(r.approved_by_1),
      approvedBy2: String(r.approved_by_2),
      approvedAt: (r.approved_at as Date).toISOString(),
      activatedAt: r.activated_at ? (r.activated_at as Date).toISOString() : null,
      policyHash: String(r.policy_hash),
    };
  }

  /** 개발 전용. ALLOW_ENV_DEADLINE_POLICY=true 일 때만. */
  private envPolicy(cycleId: string): DeadlinePolicy {
    const mode = (process.env.DEADLINE_MODE ??
      'FINALIZED_COMMIT_BEFORE_DEADLINE') as DeadlineMode;
    const deadlineAt =
      process.env.DEADLINE_AT ?? new Date(Date.now() + 86_400_000).toISOString();
    const fingerprint = createHash('sha256')
      .update(`${cycleId}|${mode}|${deadlineAt}`)
      .digest('hex')
      .slice(0, 12);

    return {
      version: `env-${fingerprint}`,
      mode,
      deadlineAt,
      approvedBy1: 'DEV-UNAPPROVED-1',
      approvedBy2: 'DEV-UNAPPROVED-2',
      approvedAt: new Date(0).toISOString(),
      activatedAt: new Date(0).toISOString(),
      policyHash: 'dev-only',
    };
  }
}
