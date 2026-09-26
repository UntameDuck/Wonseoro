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
import type { PoolClient } from 'pg';
import { ALLOW_ENV_DEADLINE_POLICY } from '../../config';
import { ActivationRecorder, ActivationView } from '../activation/activation-recorder';
import { DeadlinePolicyPort } from './deadline-policy.port';

/**
 * 연장 초안에 함께 묶이는 사실. 정책 해시에 들어가므로 승인 뒤에 바꿀 수 없다.
 * (v1.1 §B17 — 누가 언제 **왜** 연장했는지)
 */
export interface ExtensionFacts {
  kind: 'EXTENSION';
  /** 어느 정책을 연장하는가. 활성화할 때 그 정책이 여전히 적용 중이어야 한다. */
  extendsVersion: string;
  extendsDeadlineAt: string;
  reason: string;
  /** 입학처 결정 문서번호. 기술팀은 연장을 결정하지 않는다. */
  decisionRef: string;
}

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
 *   5. 활성화는 **서명된 기록**으로 남는다. 누가 언제 왜 적용했는지 (T-M3-15)
 *   6. 한 번 적용된 정책은 다시 활성화하지 않는다. 마감은 새 버전으로만 앞으로 간다
 */
@Injectable()
export class DeadlinePolicyRepository extends DeadlinePolicyPort {
  private readonly logger = new Logger(DeadlinePolicyRepository.name);

  constructor(
    private readonly db: Db,
    private readonly activations: ActivationRecorder,
  ) {
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
    if (ALLOW_ENV_DEADLINE_POLICY) {
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
    extension?: ExtensionFacts;
  }): Promise<{ policyId: string; policyHash: string }> {
    const deadline = new Date(input.deadlineAt);
    if (Number.isNaN(deadline.getTime())) {
      throw ProblemException.validationFailed('deadlineAt 이 올바른 시각이 아닙니다.');
    }
    const policyId = randomUUID();
    const snapshot = {
      cycleId: input.cycleId,
      version: input.version,
      mode: input.mode,
      deadlineAt: deadline.toISOString(),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      ...(input.extension ? { extension: input.extension } : {}),
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

  /**
   * 마감 연장 초안 — v1.1 §B17 (T-M3-14)
   *
   * **연장은 지금 적용 중인 정책을 기준으로만 만든다.**
   * 방식(mode)은 그대로 물려받는다. 연장 절차로 판정 기준까지 바꾸면, 승인자는
   * "마감이 늦춰진다" 고만 알고 승인하게 된다.
   *
   * **사유와 입학처 결정 문서번호가 필수다.** 이 시스템은 연장을 결정하지 않는다.
   * 입학처가 내린 결정을 기록하고 집행할 뿐이다. 결정 근거 없이 연장이 만들어지면
   * 기술팀이 마감을 바꾼 것과 구별되지 않는다.
   *
   * 그 뒤는 일반 정책과 같다. 작성자가 아닌 두 명이 승인해야 활성화된다.
   * 마감 임박 잠금(Freeze)에는 걸리지 않는다 — 장애로 마감을 연장해야 하는 순간이
   * 바로 마감 직전이다.
   */
  async createExtension(input: {
    cycleId: string;
    deadlineAt: string;
    reason: string;
    decisionRef: string;
    createdBy: string;
  }): Promise<{ policyId: string; policyHash: string; version: string; extendsVersion: string }> {
    const reason = input.reason?.trim() ?? '';
    const decisionRef = input.decisionRef?.trim() ?? '';
    if (reason.length < 5) {
      throw ProblemException.validationFailed('연장 사유를 구체적으로 입력해 주십시오.');
    }
    if (!decisionRef) {
      throw ProblemException.validationFailed(
        '입학처 결정 문서번호가 필요합니다. 연장은 입학처의 결정이 있어야 만들 수 있습니다.',
      );
    }

    const base = await this.db.tx((client) => this.effective(client, input.cycleId, null));
    if (!base) {
      throw ProblemException.validationFailed(
        '적용 중인 마감 정책이 없습니다. 연장할 기준이 없습니다.',
      );
    }
    const newDeadline = new Date(input.deadlineAt);
    if (Number.isNaN(newDeadline.getTime())) {
      throw ProblemException.validationFailed('deadlineAt 이 올바른 시각이 아닙니다.');
    }
    if (newDeadline.getTime() <= base.deadlineAt.getTime()) {
      throw ProblemException.validationFailed(
        `연장은 마감을 늦추는 것만 가능합니다. 현재 마감: ${base.deadlineAt.toISOString()}`,
      );
    }

    // 버전 이름에 연장 이력을 드러낸다. 목록만 봐도 무엇을 몇 번째 연장했는지 보인다.
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM deadline_policy
        WHERE cycle_id = $1 AND version LIKE $2`,
      [input.cycleId, `${base.version}-ext%`],
    );
    const version = `${base.version}-ext${Number(rows[0]?.n ?? 0) + 1}`;
    if (version.length > 64) {
      throw ProblemException.validationFailed('연장이 너무 여러 번 겹쳐 버전 이름을 만들 수 없습니다.');
    }

    const created = await this.createDraft({
      cycleId: input.cycleId,
      version,
      mode: base.mode,
      deadlineAt: newDeadline.toISOString(),
      createdBy: input.createdBy,
      extension: {
        kind: 'EXTENSION',
        extendsVersion: base.version,
        extendsDeadlineAt: base.deadlineAt.toISOString(),
        reason,
        decisionRef,
      },
    });
    this.logger.warn(
      `deadline extension drafted ${base.version} -> ${version} by ${input.createdBy} (${decisionRef})`,
    );
    return { ...created, version, extendsVersion: base.version };
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
  async activate(
    policyId: string,
    activateAt: Date | null,
    operatorId: string,
  ): Promise<{ activatedAt: string; activation: ActivationView }> {
    const state = await this.loadApprovalState(policyId);
    assertApproved(state);
    assertActivationTime(activateAt);

    const result = await this.db.tx(async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT id, cycle_id, version, mode, deadline_at, approved_by_1, approved_by_2,
                activated_at, policy_hash, immutable_snapshot
           FROM deadline_policy WHERE id = $1 FOR UPDATE`,
        [policyId],
      );
      const row = rows[0];
      if (!row) throw ProblemException.validationFailed('존재하지 않는 마감 정책입니다.');

      // 한 번 적용된 정책을 다시 올리면 옛 마감으로 되돌아간다 — 사실상 단축이다.
      // 마감은 새 버전을 만들어 승인받는 길로만 바뀐다.
      if (row.activated_at) {
        throw ProblemException.validationFailed(
          '이미 적용된 정책입니다. 마감을 바꾸려면 새 버전을 만들어 승인받아 주십시오.',
        );
      }

      const cycleId = String(row.cycle_id);
      const deadlineAt = row.deadline_at as Date;
      const snapshot = (row.immutable_snapshot ?? {}) as { extension?: ExtensionFacts };
      const extension = snapshot.extension;

      // 같은 전형의 활성화를 한 줄로 세운다. 두 연장이 동시에 같은 기준을 딛고
      // 올라가면 둘 다 "현재 정책을 연장한다" 고 믿은 채 적용된다.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deadline:${cycleId}`]);
      const base = await this.effective(client, cycleId, policyId);

      if (extension) {
        // 승인하는 사이에 다른 정책이 적용됐으면, 승인자가 본 "현재 마감" 은 더 이상 현재가 아니다.
        if (!base || base.version !== extension.extendsVersion) {
          throw ProblemException.versionConflict(
            `연장 기준 정책(${extension.extendsVersion})이 더 이상 적용 중이 아닙니다. ` +
              `현재 정책을 기준으로 연장을 다시 작성해 주십시오.`,
          );
        }
        if (deadlineAt.getTime() <= base.deadlineAt.getTime()) {
          throw ProblemException.validationFailed('연장은 마감을 늦추는 것만 가능합니다.');
        }
      }

      const { rows: updated } = await client.query<{ activated_at: Date }>(
        /**
         * 즉시 활성화면 **DB 가 시각을 찍는다.** (D-31)
         * 애플리케이션 시계가 DB 보다 앞서면 방금 활성화한 정책이 잠시 "아직 적용 전"
         * 으로 보여 마감 판정이 거부된다. 예약 활성화는 지정 시각을 그대로 쓴다.
         */
        `UPDATE deadline_policy
            SET activated_at = COALESCE($2::timestamptz, now())
          WHERE id = $1
          RETURNING activated_at`,
        [policyId, activateAt],
      );
      const activatedAt = updated[0]!.activated_at;

      // 적용하는 순간 이미 지난 마감은 적용 즉시 접수를 닫는다. 소급 마감이다.
      if (deadlineAt.getTime() <= activatedAt.getTime()) {
        throw ProblemException.validationFailed(
          '적용 시각에 이미 지난 마감입니다. 적용하면 즉시 접수가 닫힙니다.',
        );
      }

      const activation = await this.activations.record(client, {
        cycleId,
        subjectType: 'DEADLINE_POLICY',
        subjectId: policyId,
        subjectVersion: String(row.version),
        kind: extension ? 'EXTEND' : 'ACTIVATE',
        effectiveAt: activatedAt,
        operatorId,
        reason: extension?.reason ?? null,
        decisionRef: extension?.decisionRef ?? null,
        supersedesVersion: base?.version ?? null,
        content: {
          policyHash: String(row.policy_hash),
          mode: String(row.mode),
          deadlineAt: deadlineAt.toISOString(),
          previousDeadlineAt: base ? base.deadlineAt.toISOString() : null,
          approvedBy: [String(row.approved_by_1), String(row.approved_by_2)],
        },
      });
      return { activatedAt, activation };
    });

    this.logger.log(
      `deadline policy ${result.activation.subjectVersion} ${result.activation.kind} ` +
        `at ${result.activatedAt.toISOString()} by ${operatorId}`,
    );
    return { activatedAt: result.activatedAt.toISOString(), activation: result.activation };
  }

  /** 서명된 활성화 이력. 각 기록의 서명을 다시 검증해 돌려준다. */
  async activationHistory(cycleId: string): Promise<ActivationView[]> {
    return this.activations.list(cycleId, { subjectType: 'DEADLINE_POLICY' });
  }

  /**
   * 지금 효력이 있는 정책. `excludeId` 는 활성화 중인 자기 자신을 빼려고 쓴다.
   * 활성화 트랜잭션 안에서 부르므로 client 를 받는다.
   */
  private async effective(
    client: PoolClient,
    cycleId: string,
    excludeId: string | null,
  ): Promise<{ version: string; mode: DeadlineMode; deadlineAt: Date } | null> {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT version, mode, deadline_at FROM deadline_policy
        WHERE cycle_id = $1
          AND activated_at IS NOT NULL AND activated_at <= now()
          AND ($2::uuid IS NULL OR id <> $2)
        ORDER BY activated_at DESC
        LIMIT 1`,
      [cycleId, excludeId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      version: String(r.version),
      mode: r.mode as DeadlineMode,
      deadlineAt: r.deadline_at as Date,
    };
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
      /** 작성자. 화면이 "본인은 승인할 수 없음" 을 미리 보여주려고 싣는다. 막는 것은 서버다. */
      createdBy: string;
      /** 연장이면 사유·결정번호·기준 정책. */
      extension: ExtensionFacts | null;
    }>
  > {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, version, mode, deadline_at, approved_by_1, approved_by_2,
              activated_at, policy_hash, immutable_snapshot
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
      createdBy: String((r.immutable_snapshot as { createdBy?: string } | null)?.createdBy ?? ''),
      extension: (r.immutable_snapshot as { extension?: ExtensionFacts } | null)?.extension ?? null,
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
    // 빈 값은 설정하지 않은 것으로 본다. `.env.example` 이 `DEADLINE_AT=` 로 비워 두는데,
    // `??` 는 빈 문자열을 통과시켜 new Date('') — Invalid Date — 가 됐다. 그 값이 마감 임박
    // 잠금 계산에 들어가 설정 적용이 500 으로 죽었다.
    const mode = (process.env.DEADLINE_MODE ||
      'FINALIZED_COMMIT_BEFORE_DEADLINE') as DeadlineMode;
    const raw = process.env.DEADLINE_AT || new Date(Date.now() + 86_400_000).toISOString();
    if (Number.isNaN(Date.parse(raw))) {
      throw ProblemException.retryable(
        `개발용 마감 정책의 DEADLINE_AT 이 올바른 시각이 아닙니다: ${raw}`,
      );
    }
    const deadlineAt = new Date(raw).toISOString();
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
