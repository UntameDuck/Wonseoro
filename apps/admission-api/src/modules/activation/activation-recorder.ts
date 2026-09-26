import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Db } from '@wonseoro/server-kit';
import { UNIVERSITY_ID } from '../../config';
import { AuditService } from '../audit/audit.service';
import { ActivationSigner, SignatureStatus } from './activation-signer';

export type ActivationSubject = 'DEADLINE_POLICY' | 'CONFIG_VERSION';
export type ActivationKind = 'ACTIVATE' | 'EXTEND' | 'ROLLBACK';

export interface ActivationInput {
  cycleId: string;
  subjectType: ActivationSubject;
  subjectId: string;
  subjectVersion: string;
  kind: ActivationKind;
  effectiveAt: Date;
  operatorId: string;
  reason?: string | null;
  decisionRef?: string | null;
  supersedesVersion?: string | null;
  /** 대상별로 서명에 함께 묶을 사실. 해시·승인자·마감시각 등. */
  content: Record<string, unknown>;
}

export interface ActivationView {
  activationId: string;
  subjectType: ActivationSubject;
  subjectId: string;
  subjectVersion: string;
  kind: ActivationKind;
  effectiveAt: string;
  operatorId: string;
  reason: string | null;
  decisionRef: string | null;
  supersedesVersion: string | null;
  content: Record<string, unknown>;
  keyId: string;
  payloadHash: string;
  recordedAt: string;
  /** 지금 다시 검증한 결과. 저장된 값이 아니다. */
  signature: SignatureStatus;
}

/**
 * 서명된 활성화 기록 — v1.1 §B17 · §A1 · §A14 (T-M3-14·15)
 *
 * 마감 정책·설정이 **적용되는 사건**마다 한 행을 남긴다.
 * 정책·설정 행은 "무엇" 이고, 이 행은 "언제·누가·왜 그것을 적용했는가" 다.
 *
 * **반드시 활성화와 같은 트랜잭션에서 부른다.** 활성화는 됐는데 기록이 없거나,
 * 기록은 있는데 활성화가 안 된 상태가 생기면 이 기록은 증거가 아니라 소문이 된다.
 *
 * 같은 트랜잭션에서 감사 체인에도 한 줄 남긴다. 서명은 "남은 행이 진짜인가" 를,
 * 감사 체인은 "빠진 사건이 없는가" 를 증명한다. 둘은 다른 질문이다.
 */
@Injectable()
export class ActivationRecorder {
  constructor(
    private readonly db: Db,
    private readonly signer: ActivationSigner,
    private readonly audit: AuditService,
  ) {}

  async record(client: PoolClient, input: ActivationInput): Promise<ActivationView> {
    const activationId = randomUUID();
    const payload = {
      schema: 'k-admission.activation.v1',
      activationId,
      universityId: UNIVERSITY_ID,
      cycleId: input.cycleId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
      kind: input.kind,
      effectiveAt: input.effectiveAt.toISOString(),
      operatorId: input.operatorId,
      reason: input.reason ?? null,
      decisionRef: input.decisionRef ?? null,
      supersedesVersion: input.supersedesVersion ?? null,
      content: input.content,
    };
    const signed = this.signer.sign(payload);

    const { rows } = await client.query<{ recorded_at: Date }>(
      `INSERT INTO activation_record
         (id, cycle_id, subject_type, subject_id, subject_version, kind, effective_at,
          operator_id, reason, decision_ref, supersedes_version,
          payload, payload_hash, signature, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING recorded_at`,
      [
        activationId,
        input.cycleId,
        input.subjectType,
        input.subjectId,
        input.subjectVersion,
        input.kind,
        input.effectiveAt,
        input.operatorId,
        input.reason ?? null,
        input.decisionRef ?? null,
        input.supersedesVersion ?? null,
        JSON.stringify(payload),
        signed.payloadHash,
        signed.signature,
        signed.keyId,
      ],
    );

    await this.audit.record(client, {
      actorType: 'ADMIN',
      actorId: input.operatorId,
      action: 'ADMIN_CHANGED_CONFIG',
      result: 'ACCEPTED',
      ...(input.subjectType === 'DEADLINE_POLICY'
        ? { policyVersion: input.subjectVersion }
        : { configVersion: input.subjectVersion }),
      // 사유 원문은 서명된 기록에 있다. 감사에는 그 기록을 가리키는 해시만 둔다.
      details: {
        activationId,
        subjectType: input.subjectType,
        kind: input.kind,
        supersedesVersion: input.supersedesVersion ?? null,
        decisionRef: input.decisionRef ?? null,
        payloadHash: signed.payloadHash,
        keyId: signed.keyId,
      },
    });

    return {
      activationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
      kind: input.kind,
      effectiveAt: payload.effectiveAt,
      operatorId: input.operatorId,
      reason: payload.reason,
      decisionRef: payload.decisionRef,
      supersedesVersion: payload.supersedesVersion,
      content: input.content,
      keyId: signed.keyId,
      payloadHash: signed.payloadHash,
      recordedAt: (rows[0]?.recorded_at ?? new Date()).toISOString(),
      signature: 'VALID',
    };
  }

  /** 한 전형의 활성화 이력. 서명은 조회할 때마다 다시 검증한다. */
  async list(
    cycleId: string,
    filter: { subjectType?: ActivationSubject; subjectId?: string } = {},
  ): Promise<ActivationView[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, subject_type, subject_id, subject_version, kind, effective_at, operator_id,
              reason, decision_ref, supersedes_version, payload, payload_hash, signature,
              key_id, recorded_at
         FROM activation_record
        WHERE cycle_id = $1
          AND ($2::text IS NULL OR subject_type = $2)
          AND ($3::uuid IS NULL OR subject_id = $3)
        ORDER BY recorded_at, id`,
      [cycleId, filter.subjectType ?? null, filter.subjectId ?? null],
    );
    return rows.map((r) => this.toView(r));
  }

  /**
   * 운영자 행위 감사 체인 검증. 서명은 남은 기록이 진짜인지를, 체인은 빠진 기록이
   * 없는지를 말한다. 활성화 기록을 누가 트리거를 끄고 지웠다면 여기서 드러난다.
   */
  async verifySystemChain(): Promise<{ valid: boolean; brokenAt?: string; checked: number }> {
    return this.db.tx((client) => this.audit.verifySystemChain(client));
  }

  private toView(r: Record<string, unknown>): ActivationView {
    const payload = r.payload as Record<string, unknown>;
    let status = this.signer.verify({
      payload,
      payloadHash: String(r.payload_hash),
      signature: String(r.signature),
      keyId: String(r.key_id),
    });
    // 서명이 맞아도 컬럼이 서명한 내용과 다르면 거짓 기록이다.
    // 트리거가 UPDATE 를 막지만, 트리거를 끄고 고친 경우까지 잡는다.
    if (status === 'VALID' && !columnsMatchPayload(r, payload)) status = 'INVALID';

    return {
      activationId: String(r.id),
      subjectType: r.subject_type as ActivationSubject,
      subjectId: String(r.subject_id),
      subjectVersion: String(r.subject_version),
      kind: r.kind as ActivationKind,
      effectiveAt: (r.effective_at as Date).toISOString(),
      operatorId: String(r.operator_id),
      reason: r.reason === null ? null : String(r.reason),
      decisionRef: r.decision_ref === null ? null : String(r.decision_ref),
      supersedesVersion: r.supersedes_version === null ? null : String(r.supersedes_version),
      content: (payload.content as Record<string, unknown>) ?? {},
      keyId: String(r.key_id),
      payloadHash: String(r.payload_hash),
      recordedAt: (r.recorded_at as Date).toISOString(),
      signature: status,
    };
  }
}

function columnsMatchPayload(r: Record<string, unknown>, p: Record<string, unknown>): boolean {
  return (
    p.activationId === String(r.id) &&
    p.subjectId === String(r.subject_id) &&
    p.subjectVersion === String(r.subject_version) &&
    p.kind === String(r.kind) &&
    p.effectiveAt === (r.effective_at as Date).toISOString() &&
    p.operatorId === String(r.operator_id) &&
    (p.reason ?? null) === (r.reason ?? null) &&
    (p.decisionRef ?? null) === (r.decision_ref ?? null)
  );
}
