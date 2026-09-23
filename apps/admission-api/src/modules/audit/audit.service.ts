import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditAction } from '@wonseoro/contracts';
import { AUDIT_IP_SALT } from '../../config';

export interface AuditInput {
  applicationId?: string;
  actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
  /** 가명 식별자. 원본 식별자를 그대로 쓰지 않는다. */
  actorId?: string;
  action: AuditAction;
  result: 'ACCEPTED' | 'REJECTED' | 'FAILED';
  traceId?: string;
  configVersion?: string;
  policyVersion?: string;
  sourceIp?: string;
  /** 마스킹된 부가정보. 개인정보·요청 본문을 넣지 않는다. */
  details?: Record<string, unknown>;
}

/** 체인의 시작점. 첫 이벤트의 prev_hash. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * 감사 이벤트 기록 — 기술설계서 v1.0 §9, v1.1 §A11
 *
 * 보안로그가 아니라 **"마감 시각에 지원자가 어디까지 수행했는지"를 증명하는 업무 증적**이다.
 * 2026년 장애의 구제 판정에 작성·저장·제출·결제 시도 기록이 쓰였다.
 *
 * 절대 규칙
 *   1. 상태를 바꾸는 트랜잭션 **안에서** 기록한다. 커밋 후 별도로 쓰지 않는다.
 *      (별도로 쓰면 커밋은 됐는데 증적이 없는 구간이 생긴다)
 *   2. hash-chain 으로 이어 붙인다. 중간 레코드를 지우거나 고치면 검증에서 드러난다.
 *   3. 운영자에게 삭제·수정 권한을 주지 않는다. (M5 에서 WORM 저장소로 분리)
 *   4. 개인정보를 넣지 않는다. IP 는 원문이 아니라 해시로 남긴다.
 */
@Injectable()
export class AuditService {
  /**
   * 트랜잭션 안에서 감사 이벤트를 기록한다.
   * 체인은 application 단위로 잇는다 — Evidence Package 가 원서 하나를 재구성해야 하므로.
   */
  async record(client: PoolClient, input: AuditInput): Promise<string> {
    const occurredAt = new Date();
    const prevHash = await this.lastHash(client, input.applicationId);

    const eventId = randomUUID();
    const sourceIpHash = input.sourceIp ? this.hashIp(input.sourceIp) : null;

    const eventHash = this.chainHash(prevHash, {
      eventId,
      occurredAt: occurredAt.toISOString(),
      applicationId: input.applicationId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      result: input.result,
      configVersion: input.configVersion ?? null,
      policyVersion: input.policyVersion ?? null,
    });

    await client.query(
      `INSERT INTO audit_event (
         id, application_id, actor_type, actor_id, action, result,
         trace_id, config_version, policy_version, source_ip_hash,
         prev_hash, event_hash, details_redacted, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        eventId,
        input.applicationId ?? null,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.result,
        input.traceId ?? null,
        input.configVersion ?? null,
        input.policyVersion ?? null,
        sourceIpHash,
        prevHash,
        eventHash,
        JSON.stringify(input.details ?? {}),
        occurredAt,
      ],
    );

    return eventHash;
  }

  /**
   * 체인 무결성 검증. Evidence Package 생성 시 함께 돌린다. (M3 T-M3-07)
   * 한 건이라도 끊기면 그 지점을 반환한다.
   */
  async verifyChain(
    client: PoolClient,
    applicationId: string,
  ): Promise<{ valid: boolean; brokenAt?: string; checked: number }> {
    const { rows } = await client.query<{
      id: string;
      application_id: string | null;
      actor_type: string;
      actor_id: string | null;
      action: string;
      result: string;
      config_version: string | null;
      policy_version: string | null;
      prev_hash: string;
      event_hash: string;
      occurred_at: Date;
    }>(
      `SELECT id, application_id, actor_type, actor_id, action, result,
              config_version, policy_version, prev_hash, event_hash, occurred_at
         FROM audit_event
        WHERE application_id = $1
        ORDER BY occurred_at ASC, id ASC`,
      [applicationId],
    );

    let expectedPrev = GENESIS_HASH;
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) {
        return { valid: false, brokenAt: row.id, checked: rows.length };
      }
      const recomputed = this.chainHash(row.prev_hash, {
        eventId: row.id,
        occurredAt: row.occurred_at.toISOString(),
        applicationId: row.application_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        result: row.result,
        configVersion: row.config_version,
        policyVersion: row.policy_version,
      });
      if (recomputed !== row.event_hash) {
        return { valid: false, brokenAt: row.id, checked: rows.length };
      }
      expectedPrev = row.event_hash;
    }

    return { valid: true, checked: rows.length };
  }

  private async lastHash(client: PoolClient, applicationId?: string): Promise<string> {
    if (!applicationId) return GENESIS_HASH;
    const { rows } = await client.query<{ event_hash: string }>(
      `SELECT event_hash FROM audit_event
        WHERE application_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1`,
      [applicationId],
    );
    return rows[0]?.event_hash ?? GENESIS_HASH;
  }

  private chainHash(prevHash: string, fields: Record<string, unknown>): string {
    const canonical = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${String(fields[k])}`)
      .join('&');
    return createHash('sha256').update(`${prevHash}|${canonical}`).digest('hex');
  }

  /** IP 원문을 저장하지 않는다. (v1.0 §9 sourceIpHash) */
  /**
   * IP 는 원문으로 남기지 않는다. 소금이 고정값이면 가명처리가 아니다 —
   * IPv4 전체를 해시해 대조하면 몇 초면 원본이 나온다.
   * 그래서 운영에서는 소금이 없으면 기동하지 않는다.
   */
  private hashIp(ip: string): string {
    return createHash('sha256').update(`${AUDIT_IP_SALT}|${ip}`).digest('hex');
  }
}
