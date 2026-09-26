import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { validateRetention } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { CONFIG_FREEZE_HOURS } from '../../config';
import { ActivationRecorder, ActivationView } from '../activation/activation-recorder';
import { DeadlineService } from '../deadline/deadline.service';
import { ConfigDiff, diffConfig } from './config-diff';
import { addApproval, assertActivationTime, assertApproved } from './two-person-rule';

export interface ConfigVersionRow {
  id: string;
  version: string;
  status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  configHash: string;
  createdBy: string;
  approvedBy: string[];
  activatedAt: string | null;
}

/**
 * Configuration Governance — 기술설계서 v1.1 §A14·§C5 (T-M3-02)
 *
 * 마감시각·전형료·모집단위·지원자격·PG 설정이 전부 여기 들어간다.
 * **운영자 한 명이 이것들을 혼자 바꿀 수 없어야 한다.** (§01 E)
 *
 * 수명주기
 *   DRAFT → (서로 다른 2인 승인) → APPROVED → (활성화) → ACTIVE
 *   기존 ACTIVE 는 RETIRED 로 물러난다
 *
 * 2인 승인만으로는 부족하다
 *   빈 Config 를 절차대로 활성화해 모든 양식이 사라진 적이 있다. 승인 두 명,
 *   활성화 성공 — 절차는 정상이었다. 승인자가 **무엇이 바뀌는지** 보지 못하면
 *   사람이 둘이어도 사고를 막지 못한다. 그래서 승인에 Diff 확인을 묶는다.
 *
 * 되돌리기
 *   Rollback 은 새 버전을 만들지 않는다. **전에 ACTIVE 였던 그 버전을 다시 올린다.**
 *   그 행에는 이미 두 명의 실제 승인이 기록돼 있다. 새로 만들면 승인자를 지어내야 하고,
 *   그건 D-21 로 막은 것을 코드로 우회하는 일이다.
 *
 * Freeze
 *   마감이 임박하면 설정을 바꾸지 않는다. 다만 **되돌리기는 막지 않는다** —
 *   Freeze 는 새 변경을 멈추는 장치이지 복구를 멈추는 장치가 아니다.
 *
 * 서명된 활성화 기록 (T-M3-15)
 *   활성화·되돌리기마다 누가·언제·왜 를 서명해 남긴다. 되돌리기는 같은 행의
 *   activated_at 을 덮어쓰므로, 이 기록이 없으면 두 번째 적용이 첫 번째 적용의
 *   흔적을 지운다.
 */
@Injectable()
export class ConfigVersionService {
  private readonly logger = new Logger(ConfigVersionService.name);

  constructor(
    private readonly db: Db,
    private readonly deadline: DeadlineService,
    private readonly activations: ActivationRecorder,
  ) {}

  async createDraft(input: {
    cycleId: string;
    version: string;
    config: Record<string, unknown>;
    createdBy: string;
  }): Promise<ConfigVersionRow> {
    assertRetention(input.config);
    const id = randomUUID();
    const configHash = createHash('sha256')
      .update(JSON.stringify(input.config))
      .digest('hex');

    await this.db.query(
      `INSERT INTO config_version
         (id, cycle_id, version, status, config_json, config_hash, created_by)
       VALUES ($1,$2,$3,'DRAFT',$4,$5,$6)`,
      [id, input.cycleId, input.version, JSON.stringify(input.config), configHash, input.createdBy],
    );

    this.logger.log(`config draft ${input.version} created by ${input.createdBy}`);
    return this.load(id);
  }

  /**
   * 승인. **본 Diff 의 digest 를 함께 받는다.**
   *
   * 승인은 "이 설정 ID 에 동의한다" 가 아니라 "이 변경에 동의한다" 는 뜻이다.
   * 승인자가 화면을 본 뒤에 초안이나 기준이 바뀌면 같은 승인이 다른 의미가 된다.
   * digest 가 어긋나면 다시 보라고 돌려보낸다.
   */
  async approve(
    configId: string,
    approver: string,
    acknowledgedDiffDigest: string,
  ): Promise<ConfigVersionRow> {
    const row = await this.load(configId);
    if (row.status !== 'DRAFT' && row.status !== 'APPROVED') {
      throw ProblemException.validationFailed(
        `승인할 수 없는 상태입니다. (현재: ${row.status})`,
      );
    }

    const diff = await this.diff(configId);
    if (!acknowledgedDiffDigest) {
      throw ProblemException.validationFailed(
        '변경 내역(Diff)을 확인한 뒤 승인해 주십시오.',
      );
    }
    if (acknowledgedDiffDigest !== diff.digest) {
      // 본 뒤에 초안이나 현재 설정이 바뀌었다.
      throw ProblemException.versionConflict(
        '확인하신 변경 내역이 바뀌었습니다. 변경 내역을 다시 확인한 뒤 승인해 주십시오.',
      );
    }
    if (diff.identical) {
      // 아무것도 바뀌지 않는 설정을 올리는 것은 대개 잘못 만든 초안이다.
      throw ProblemException.validationFailed(
        '현재 설정과 동일합니다. 바뀌는 내용이 없는 설정은 승인하지 않습니다.',
      );
    }

    const result = addApproval(
      {
        createdBy: row.createdBy,
        approvedBy1: row.approvedBy[0] ?? null,
        approvedBy2: row.approvedBy[1] ?? null,
      },
      approver,
    );

    await this.db.query(
      `UPDATE config_version
          SET approved_by_1 = $2,
              approved_by_2 = $3,
              approved_at = CASE WHEN $4 THEN now() ELSE approved_at END,
              status = CASE WHEN $4 THEN 'APPROVED' ELSE status END
        WHERE id = $1`,
      [configId, result.approvedBy1, result.approvedBy2, result.complete],
    );

    this.logger.log(`config ${row.version} approved by ${approver} (complete=${result.complete})`);
    return this.load(configId);
  }

  /**
   * 활성화. 기존 ACTIVE 를 RETIRED 로 내리고 이것을 올린다.
   * **한 트랜잭션에서 한다.** 중간에 끊기면 활성 Config 가 0개이거나 2개가 된다.
   */
  async activate(
    configId: string,
    activateAt: Date | null,
    operatorId: string,
  ): Promise<ConfigVersionRow & { activation: ActivationView }> {
    const row = await this.load(configId);
    assertApproved({
      createdBy: row.createdBy,
      approvedBy1: row.approvedBy[0] ?? null,
      approvedBy2: row.approvedBy[1] ?? null,
    });
    assertActivationTime(activateAt);
    // 초안을 만든 뒤 법정 기준이 올라갔을 수 있다. 적용하는 순간 다시 본다.
    assertRetention(await this.configJson(configId));

    const { rows: cyc } = await this.db.query<{ cycle_id: string }>(
      `SELECT cycle_id FROM config_version WHERE id = $1`,
      [configId],
    );
    await this.assertNotFrozen(String(cyc[0]?.cycle_id), activateAt ?? new Date());

    const activation = await this.db.tx(async (client) => {
      const { rows } = await client.query<{ cycle_id: string }>(
        `SELECT cycle_id FROM config_version WHERE id = $1 FOR UPDATE`,
        [configId],
      );
      const cycleId = rows[0]?.cycle_id;
      if (!cycleId) throw ProblemException.validationFailed('존재하지 않는 설정입니다.');

      const { rows: cur } = await client.query<{ version: string }>(
        `SELECT version FROM config_version
          WHERE cycle_id = $1 AND status = 'ACTIVE' AND id <> $2
          FOR UPDATE`,
        [cycleId, configId],
      );
      await client.query(
        `UPDATE config_version SET status = 'RETIRED'
          WHERE cycle_id = $1 AND status = 'ACTIVE' AND id <> $2`,
        [cycleId, configId],
      );
      // 즉시 활성화면 DB 가 시각을 찍는다. 애플리케이션 시계가 DB 보다 앞서면
      // 방금 활성화한 설정이 잠시 "아직 적용 전" 으로 보인다.
      const { rows: updated } = await client.query<{ activated_at: Date }>(
        `UPDATE config_version
            SET status = 'ACTIVE', activated_at = COALESCE($2::timestamptz, now())
          WHERE id = $1
          RETURNING activated_at`,
        [configId, activateAt],
      );

      return this.activations.record(client, {
        cycleId,
        subjectType: 'CONFIG_VERSION',
        subjectId: configId,
        subjectVersion: row.version,
        kind: 'ACTIVATE',
        effectiveAt: updated[0]!.activated_at,
        operatorId,
        supersedesVersion: cur[0]?.version ?? null,
        content: {
          configHash: row.configHash,
          approvedBy: row.approvedBy,
          createdBy: row.createdBy,
        },
      });
    });

    this.logger.log(`config ${row.version} activated by ${operatorId}`);
    return { ...(await this.load(configId)), activation };
  }

  /**
   * 이 초안이 현재 활성 설정과 무엇이 다른가.
   * 승인 화면이 그대로 그려서 보여준다.
   */
  async diff(configId: string): Promise<ConfigDiff> {
    const { rows } = await this.db.query<{ cycle_id: string; config_json: Record<string, unknown> }>(
      `SELECT cycle_id, config_json FROM config_version WHERE id = $1`,
      [configId],
    );
    const target = rows[0];
    if (!target) throw ProblemException.validationFailed('존재하지 않는 설정입니다.');

    const { rows: base } = await this.db.query<{ config_json: Record<string, unknown> }>(
      `SELECT config_json FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE' AND id <> $2
        LIMIT 1`,
      [target.cycle_id, configId],
    );

    // 활성 설정이 없으면 빈 것과 비교한다. 첫 설정은 전부 추가다.
    return diffConfig(base[0]?.config_json ?? {}, target.config_json);
  }

  /**
   * 되돌리기.
   *
   * **새 버전을 만들지 않는다.** 전에 ACTIVE 였던 그 버전을 다시 올린다.
   * 그 행에는 이미 서로 다른 두 명의 실제 승인이 기록돼 있다.
   * 새로 만들면 승인자를 지어내야 하고, 그건 D-21 로 막은 것을 코드로 우회하는 일이다.
   *
   * 그래서 되돌릴 수 있는 대상은 **한 번이라도 실제로 적용된 적이 있는 설정**뿐이다.
   * 활성화된 적 없는 초안으로 가는 것은 되돌리기가 아니라 새 변경이다.
   *
   * 마감 임박 잠금(Freeze)은 여기 적용하지 않는다.
   * Freeze 는 새 변경을 멈추는 장치이지 복구를 멈추는 장치가 아니다.
   * 잘못된 설정으로 마감을 맞는 것이 훨씬 큰 사고다.
   */
  async rollback(input: {
    targetConfigId: string;
    operator: string;
    reason: string;
  }): Promise<{ restored: ConfigVersionRow; retired: string | null; activation: ActivationView }> {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 2) {
      throw ProblemException.validationFailed('되돌리는 사유를 입력해 주십시오.');
    }

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT cycle_id, version, status, activated_at, created_by,
              approved_by_1, approved_by_2, config_hash
         FROM config_version WHERE id = $1`,
      [input.targetConfigId],
    );
    const target = rows[0];
    if (!target) throw ProblemException.validationFailed('존재하지 않는 설정입니다.');

    if (!target.activated_at) {
      throw ProblemException.validationFailed(
        '한 번도 적용된 적이 없는 설정입니다. 되돌리기 대상이 아닙니다.',
      );
    }
    if (target.status === 'ACTIVE') {
      throw ProblemException.validationFailed('이미 활성화된 설정입니다.');
    }

    // 되돌리기도 법정 보존기준을 넘을 수 없다. 복구가 파기의 뒷문이 되면 안 된다.
    assertRetention(await this.configJson(input.targetConfigId));

    // 이 행의 승인 기록이 온전한지 다시 본다. 되돌리기가 승인 규칙의 뒷문이 되면 안 된다.
    assertApproved({
      createdBy: String(target.created_by ?? ''),
      approvedBy1: asApprover(target.approved_by_1),
      approvedBy2: asApprover(target.approved_by_2),
    });

    const { retired, activation } = await this.db.tx(async (client) => {
      const { rows: cur } = await client.query<{ id: string; version: string }>(
        `SELECT id, version FROM config_version
          WHERE cycle_id = $1 AND status = 'ACTIVE'
          FOR UPDATE`,
        [String(target.cycle_id)],
      );
      await client.query(
        `UPDATE config_version SET status = 'RETIRED'
          WHERE cycle_id = $1 AND status = 'ACTIVE'`,
        [String(target.cycle_id)],
      );
      const { rows: updated } = await client.query<{ activated_at: Date }>(
        `UPDATE config_version SET status = 'ACTIVE', activated_at = now()
          WHERE id = $1 RETURNING activated_at`,
        [input.targetConfigId],
      );
      const retiredVersion = cur[0]?.version ?? null;

      // 사유가 로그에만 있으면 로그 보존기간이 지나면 사라진다. 서명된 기록으로 남긴다.
      const recorded = await this.activations.record(client, {
        cycleId: String(target.cycle_id),
        subjectType: 'CONFIG_VERSION',
        subjectId: input.targetConfigId,
        subjectVersion: String(target.version),
        kind: 'ROLLBACK',
        effectiveAt: updated[0]!.activated_at,
        operatorId: input.operator,
        reason,
        supersedesVersion: retiredVersion,
        content: {
          configHash: String(target.config_hash),
          approvedBy: [String(target.approved_by_1), String(target.approved_by_2)],
          createdBy: String(target.created_by ?? ''),
        },
      });
      return { retired: retiredVersion, activation: recorded };
    });

    this.logger.warn(
      `config rolled back to ${String(target.version)} by ${input.operator} ` +
        `(from ${retired ?? 'none'}): ${reason}`,
    );
    return { restored: await this.load(input.targetConfigId), retired, activation };
  }

  /**
   * 마감 임박 구간인가. (§A14 Freeze)
   *
   * 마지막 몇 시간에 지원자가 몰리고, 그때의 설정 변경은 검증할 시간이 없다.
   * 활성 마감정책이 없으면 판단하지 않고 통과시킨다 — 그 경우는 마감 판정 자체가
   * 이미 거부되고 있어서, 여기서 또 막으면 원인이 가려진다.
   */
  private async assertNotFrozen(cycleId: string, activateAt: Date): Promise<void> {
    if (CONFIG_FREEZE_HOURS <= 0) return;

    let deadlineAt: Date;
    try {
      const snapshot = await this.deadline.snapshot(cycleId);
      deadlineAt = new Date(snapshot.deadlineAt);
    } catch (err) {
      // 통과시키되 조용히 넘어가지 않는다. 잠금이 꺼진 채로 도는 것을
      // 아무도 모르면, 잠금이 있다고 믿고 다른 판단을 하게 된다.
      this.logger.warn(
        `마감 정책을 읽지 못해 설정 잠금을 판정하지 못했습니다 (cycle=${cycleId}): ` +
          `${(err as Error).message}`,
      );
      return;
    }

    const freezeFrom = new Date(deadlineAt.getTime() - CONFIG_FREEZE_HOURS * 3_600_000);
    if (activateAt < freezeFrom) return;

    throw ProblemException.forbidden(
      `마감 ${CONFIG_FREEZE_HOURS}시간 전부터는 설정을 변경할 수 없습니다. ` +
        `(잠금 시작 ${freezeFrom.toISOString()}, 마감 ${deadlineAt.toISOString()}) ` +
        `마감 연장이 필요하면 마감 정책으로 처리해 주십시오.`,
    );
  }

  private async configJson(configId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ config_json: Record<string, unknown> }>(
      `SELECT config_json FROM config_version WHERE id = $1`,
      [configId],
    );
    return rows[0]?.config_json ?? {};
  }

  async active(cycleId: string): Promise<ConfigVersionRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [cycleId],
    );
    return rows[0] ? this.load(String(rows[0].id)) : null;
  }

  /**
   * 한 모집의 설정 버전 목록. 관리자 콘솔의 승인 대기함이 쓴다.
   * 본문(config_json)은 싣지 않는다 — 무엇이 바뀌는지는 diff 로 본다.
   */
  async list(cycleId: string): Promise<Array<ConfigVersionRow & { createdAt: string }>> {
    const { rows } = await this.db.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM config_version WHERE cycle_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [cycleId],
    );
    const out: Array<ConfigVersionRow & { createdAt: string }> = [];
    for (const r of rows) {
      out.push({ ...(await this.load(r.id)), createdAt: r.created_at.toISOString() });
    }
    return out;
  }

  async load(configId: string): Promise<ConfigVersionRow> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, version, status, config_hash, created_by,
              approved_by_1, approved_by_2, activated_at
         FROM config_version WHERE id = $1`,
      [configId],
    );
    const r = rows[0];
    if (!r) throw ProblemException.validationFailed('존재하지 않는 설정입니다.');
    return {
      id: String(r.id),
      version: String(r.version),
      status: r.status as ConfigVersionRow['status'],
      configHash: String(r.config_hash),
      createdBy: String(r.created_by),
      approvedBy: [r.approved_by_1, r.approved_by_2]
        .filter((a): a is string => typeof a === 'string' && a.length > 0),
      activatedAt: r.activated_at ? (r.activated_at as Date).toISOString() : null,
    };
  }
}

/** 'DRAFT:' 같은 자리표시자는 승인자가 아니다. */
function asApprover(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && !v.startsWith('DRAFT:') ? v : null;
}

/**
 * 보존 정책 검증 (v1.1 §A15, T-M3-10).
 *
 * `retention` 섹션이 없으면 통과시킨다 — 아직 정하지 않은 대학이 있고, 없는 동안은
 * 아무것도 파기 대상이 되지 않는다(파기 계획이 "미설정" 으로 보여준다).
 * 있으면 법정 하한·불변 기록·누락·정합성을 전부 본다. 문제는 한 번에 모두 알려준다.
 */
function assertRetention(config: Record<string, unknown>): void {
  if (config.retention === undefined) return;
  const problems = validateRetention(config.retention);
  if (problems.length === 0) return;
  throw ProblemException.validationFailed(
    `보존 정책이 기준에 맞지 않습니다. ${problems
      .map((p) => `[${p.category}] ${p.message}`)
      .join(' ')}`,
  );
}
