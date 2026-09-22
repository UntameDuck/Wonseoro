import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
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
 * ⚠️ `config_version` 에는 승인 관련 DB 제약이 없다. (불일치 대장 D-21)
 * 지금은 이 서비스가 유일한 방어선이다. DDL 제약이 들어가야 한다.
 */
@Injectable()
export class ConfigVersionService {
  private readonly logger = new Logger(ConfigVersionService.name);

  constructor(private readonly db: Db) {}

  async createDraft(input: {
    cycleId: string;
    version: string;
    config: Record<string, unknown>;
    createdBy: string;
  }): Promise<ConfigVersionRow> {
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

  async approve(configId: string, approver: string): Promise<ConfigVersionRow> {
    const row = await this.load(configId);
    if (row.status !== 'DRAFT' && row.status !== 'APPROVED') {
      throw ProblemException.validationFailed(
        `승인할 수 없는 상태입니다. (현재: ${row.status})`,
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
  async activate(configId: string, activateAt: Date | null): Promise<ConfigVersionRow> {
    const row = await this.load(configId);
    assertApproved({
      createdBy: row.createdBy,
      approvedBy1: row.approvedBy[0] ?? null,
      approvedBy2: row.approvedBy[1] ?? null,
    });
    assertActivationTime(activateAt);

    await this.db.tx(async (client) => {
      const { rows } = await client.query<{ cycle_id: string }>(
        `SELECT cycle_id FROM config_version WHERE id = $1 FOR UPDATE`,
        [configId],
      );
      const cycleId = rows[0]?.cycle_id;
      if (!cycleId) throw ProblemException.validationFailed('존재하지 않는 설정입니다.');

      await client.query(
        `UPDATE config_version SET status = 'RETIRED'
          WHERE cycle_id = $1 AND status = 'ACTIVE' AND id <> $2`,
        [cycleId, configId],
      );
      await client.query(
        `UPDATE config_version SET status = 'ACTIVE', activated_at = $2 WHERE id = $1`,
        [configId, activateAt ?? new Date()],
      );
    });

    this.logger.log(`config ${row.version} activated`);
    return this.load(configId);
  }

  async active(cycleId: string): Promise<ConfigVersionRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id FROM config_version WHERE cycle_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [cycleId],
    );
    return rows[0] ? this.load(String(rows[0].id)) : null;
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
