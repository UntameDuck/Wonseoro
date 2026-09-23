import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApplicationStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
import { ApplicationStateService } from './application-state.service';
import { ProfileVaultClient } from './profile-vault.client';

export interface ApplicationRow {
  id: string;
  cycleId: string;
  applicantId: string;
  admissionTypeId: string;
  /** 추가문항 스키마를 고르는 키. (v1.1 §A5) */
  admissionTypeCode: string;
  departmentId: string;
  status: ApplicationStatus;
  version: string;
  lastSavedAt: string | null;
}

export interface CreateApplicationInput {
  cycleId: string;
  applicantId: string;
  admissionTypeId: string;
  departmentId: string;
  /** 중앙 Vault 조회 키. 없으면 Snapshot 을 건너뛴다. */
  subjectToken?: string;
  universityId?: string;
  traceId?: string;
  sourceIp?: string;
}

export interface PatchApplicationInput {
  applicationId: string;
  expectedVersion: bigint;
  admissionTypeId?: string;
  departmentId?: string;
  fields?: Record<string, unknown>;
  schemaVersion: string;
  traceId?: string;
  sourceIp?: string;
}

const SELECT_COLS = `
  a.id, a.cycle_id, a.applicant_id, a.admission_type_id, a.department_id,
  a.status, a.version, a.last_saved_at, t.code AS admission_type_code`;

const FROM_APPLICATION = `
  FROM application a
  JOIN admission_type t ON t.id = a.admission_type_id`;

@Injectable()
export class ApplicationRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly state: ApplicationStateService,
    private readonly vault: ProfileVaultClient,
  ) {}

  /**
   * 원서 생성.
   *
   * 생성의 멱등성은 idempotency_record 가 아니라 **자연키**가 보장한다.
   * UNIQUE (cycle_id, applicant_id, admission_type_id, department_id) WHERE status <> 'CANCELLED'
   * 같은 지원자가 같은 전형·모집단위에 **유효한** 원서를 둘 가질 수 없다. (D-12, D-29)
   *
   * 따라서 재시도는 기존 원서를 그대로 돌려준다. 오류가 아니다.
   */
  async create(input: CreateApplicationInput): Promise<{ row: ApplicationRow; created: boolean }> {
    // ⚠️ 중앙 호출은 트랜잭션 **밖**에서 한다. 락 유지 시간이 중앙 지연에 묶이면 안 된다.
    // 실패해도 빈 Snapshot 으로 계속 간다. 중앙이 없다고 접수 기회를 잃으면 안 된다. (D-18)
    const snapshot =
      input.subjectToken && input.universityId
        ? await this.vault.fetchSnapshot({
            subjectToken: input.subjectToken,
            universityId: input.universityId,
            applicationRef: `${input.cycleId}:${input.applicantId}`,
          })
        : { fields: {}, releasedFields: [], withheldFields: [], available: false };

    return this.db.tx(async (client) => {
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO application
           (id, cycle_id, applicant_id, admission_type_id, department_id, status)
         VALUES ($1,$2,$3,$4,$5,'DRAFT')
         -- 취소된 원서는 자연키에서 빠진다. 착오로 취소한 지원자가 마감 전에
         -- 다시 지원할 수 있어야 한다. (D-29 / 0002 마이그레이션)
         ON CONFLICT (cycle_id, applicant_id, admission_type_id, department_id)
           WHERE status <> 'CANCELLED'
         DO NOTHING`,
        [id, input.cycleId, input.applicantId, input.admissionTypeId, input.departmentId],
      );

      const row = await this.selectOne(client, {
        cycleId: input.cycleId,
        applicantId: input.applicantId,
        admissionTypeId: input.admissionTypeId,
        departmentId: input.departmentId,
      });

      const created = inserted.rowCount === 1;
      if (created) {
        // 동의된 공통원서 필드를 시점 Snapshot 으로 복사한다.
        // 이후 중앙 Profile 이 바뀌어도 이 원서는 바뀌지 않는다. (v1.1 §10 §3)
        for (const code of snapshot.releasedFields) {
          await client.query(
            `INSERT INTO application_field_value
               (id, application_id, field_code, schema_version, value_json)
             VALUES ($1,$2,$3,'profile-snapshot',$4)
             ON CONFLICT (application_id, field_code) DO NOTHING`,
            [randomUUID(), row.id, code, JSON.stringify(snapshot.fields[code] ?? null)],
          );
        }

        // 누가 어떤 필드를 이 대학에 제공했는지 남긴다. (v1.0 §8.3 접근 증적)
        if (snapshot.releasedFields.length > 0) {
          await client.query(
            `INSERT INTO consent_record
               (id, application_id, consent_code, policy_version, granted, granted_at, evidence_hash)
             VALUES ($1,$2,'PROFILE_SNAPSHOT','v1',true,now(),$3)
             ON CONFLICT (application_id, consent_code, policy_version) DO NOTHING`,
            [randomUUID(), row.id, snapshot.releasedFields.sort().join(',').slice(0, 128)],
          );
        }

        await this.audit.record(client, {
          applicationId: row.id,
          actorType: 'APPLICANT',
          actorId: input.applicantId,
          action: 'APPLICATION_CREATED',
          result: 'ACCEPTED',
          ...(input.traceId ? { traceId: input.traceId } : {}),
          ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
          // 값은 남기지 않는다. 어떤 필드가 왔고 무엇이 막혔는지만 남긴다.
          details: {
            profileSnapshot: snapshot.available ? 'APPLIED' : 'UNAVAILABLE',
            releasedFields: snapshot.releasedFields,
            withheldFields: snapshot.withheldFields,
          },
        });
      }

      return { row, created };
    });
  }

  async findById(applicationId: string): Promise<ApplicationRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT ${SELECT_COLS} ${FROM_APPLICATION} WHERE a.id = $1`,
      [applicationId],
    );
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  async fields(applicationId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ field_code: string; value_json: unknown }>(
      `SELECT field_code, value_json FROM application_field_value WHERE application_id = $1`,
      [applicationId],
    );
    return Object.fromEntries(rows.map((r) => [r.field_code, r.value_json]));
  }

  /**
   * 자동저장 / Draft 수정.
   *
   * 조건부 UPDATE 로 낙관적 동시성을 건다. (v1.1 §B3)
   * 읽고-검사하고-쓰면 마감 피크 경합에서 두 요청이 모두 통과한다.
   * affectedRows 가 0이면 다른 요청이 먼저 바꾼 것이므로 409 다.
   */
  async patch(input: PatchApplicationInput): Promise<ApplicationRow> {
    return this.db.tx(async (client) => {
      // 잠금과 함께 현재 상태를 읽는다. 수정 가능 상태인지 먼저 본다.
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT ${SELECT_COLS} ${FROM_APPLICATION} WHERE a.id = $1 FOR UPDATE OF a`,
        [input.applicationId],
      );
      const current = rows[0] ? this.toRow(rows[0]) : null;
      if (!current) {
        throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
      }
      if (current.status === 'FINALIZED') {
        // 접수 완료 후에는 업무필드를 고칠 수 없다. (v1.1 §02)
        throw ProblemException.alreadyFinalized();
      }
      if (!this.state.isEditable(current.status)) {
        throw ProblemException.versionConflict(
          `현재 상태(${current.status})에서는 원서를 수정할 수 없습니다.`,
        );
      }

      const updated = await client.query(
        `UPDATE application
            SET admission_type_id = COALESCE($3, admission_type_id),
                department_id     = COALESCE($4, department_id),
                version           = version + 1,
                last_saved_at     = now(),
                updated_at        = now()
          WHERE id = $1 AND version = $2`,
        [
          input.applicationId,
          input.expectedVersion.toString(),
          input.admissionTypeId ?? null,
          input.departmentId ?? null,
        ],
      );

      if (updated.rowCount === 0) {
        // If-Match 로 받은 버전이 최신이 아니다. 사용자의 입력을 덮어쓰지 않는다.
        throw ProblemException.preconditionFailed(
          `원서가 이미 수정되었습니다. 최신 상태를 다시 조회해 주십시오. (기대 버전 ${input.expectedVersion})`,
        );
      }

      for (const [code, value] of Object.entries(input.fields ?? {})) {
        await client.query(
          `INSERT INTO application_field_value
             (id, application_id, field_code, schema_version, value_json)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (application_id, field_code)
           DO UPDATE SET value_json = EXCLUDED.value_json,
                         schema_version = EXCLUDED.schema_version,
                         updated_at = now()`,
          [
            randomUUID(),
            input.applicationId,
            code,
            input.schemaVersion,
            JSON.stringify(value ?? null),
          ],
        );
      }

      await this.audit.record(client, {
        applicationId: input.applicationId,
        actorType: 'APPLICANT',
        actorId: current.applicantId,
        action: 'APPLICATION_SAVED',
        result: 'ACCEPTED',
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
        // 어떤 필드를 저장했는지만 남긴다. 값은 남기지 않는다. (v1.1 §B8)
        details: { fieldCodes: Object.keys(input.fields ?? {}) },
      });

      const after = await client.query<Record<string, unknown>>(
        `SELECT ${SELECT_COLS} ${FROM_APPLICATION} WHERE a.id = $1`,
        [input.applicationId],
      );
      return this.toRow(after.rows[0] as Record<string, unknown>);
    });
  }

  private async selectOne(
    client: PoolClient,
    key: {
      cycleId: string;
      applicantId: string;
      admissionTypeId: string;
      departmentId: string;
    },
  ): Promise<ApplicationRow> {
    const { rows } = await client.query<Record<string, unknown>>(
      // 취소된 원서는 제외한다. 포함하면 재지원 직후 옛 취소 건이 돌아올 수 있다.
      `SELECT ${SELECT_COLS} ${FROM_APPLICATION}
        WHERE a.cycle_id = $1 AND a.applicant_id = $2
          AND a.admission_type_id = $3 AND a.department_id = $4
          AND a.status <> 'CANCELLED'`,
      [key.cycleId, key.applicantId, key.admissionTypeId, key.departmentId],
    );
    const row = rows[0];
    if (!row) throw ProblemException.retryable('원서를 생성하지 못했습니다.');
    return this.toRow(row);
  }

  private toRow(r: Record<string, unknown>): ApplicationRow {
    return {
      id: String(r.id),
      cycleId: String(r.cycle_id),
      applicantId: String(r.applicant_id),
      admissionTypeId: String(r.admission_type_id),
      admissionTypeCode: String(r.admission_type_code),
      departmentId: String(r.department_id),
      status: r.status as ApplicationStatus,
      // bigint 는 pg 가 문자열로 준다. 정밀도 손실을 막기 위해 문자열로 유지한다.
      version: String(r.version),
      lastSavedAt: r.last_saved_at ? (r.last_saved_at as Date).toISOString() : null,
    };
  }
}
