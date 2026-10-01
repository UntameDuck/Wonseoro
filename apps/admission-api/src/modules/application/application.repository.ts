import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CENTRAL_ID_SALT } from '../../config';
import { ApplicationStatus, APPLICATION_STATUS_LABEL, labelOf } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import type { Queryable } from '../../common/db/queryable';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
import { ApplicationStateService, transitionApplication } from './application-state.service';
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
  /**
   * 요청이 주장하는 중앙 가명 토큰(개발 헤더·게이트웨이). **믿지 않는다** — 등록된 지원자의 토큰과
   * 다르면 거절한다. Vault 조회에는 등록된 값을 쓴다. 남의 토큰을 보내 남의 공통원서를 끌어올 수 없게.
   */
  subjectToken?: string;
  universityId?: string;
  /** 전형 양식이 공통원서에서 가져오겠다고 표시한 항목. 비어 있으면 Vault 에 묻지 않는다. */
  requestedFields?: string[];
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
   * UNIQUE (cycle_id, applicant_id, admission_type_id) WHERE status <> 'CANCELLED'
   * 같은 지원자가 한 전형에 **유효한** 원서를 둘 가질 수 없다 — 모집단위가 달라도.
   * "하나의 전형에서는 하나의 모집단위에만 지원" (대학입학전형기본사항, D-12, D-29)
   *
   * 따라서 같은 모집단위로의 재시도는 기존 원서를 그대로 돌려준다. 오류가 아니다.
   * 다른 모집단위면 409 다 — 기존 원서를 돌려주면 고른 모집단위로 만들어진 줄 안다.
   */
  async create(input: CreateApplicationInput): Promise<{ row: ApplicationRow; created: boolean }> {
    // 전형·모집단위가 이 모집 주기의 것이고 지금 모집 중인지 먼저 본다. 외래키는 행이 있는지만 본다 —
    // 다른 주기의 전형으로 원서를 만들면 전형료·양식·마감이 엉뚱한 주기 것으로 적용된다.
    await this.assertCatalog(this.db, input.cycleId, input.admissionTypeId, input.departmentId);

    const subjectToken = await this.registeredSubjectToken(input.applicantId, input.subjectToken);

    // ⚠️ 중앙 호출은 트랜잭션 **밖**에서 한다. 락 유지 시간이 중앙 지연에 묶이면 안 된다.
    // 실패해도 빈 Snapshot 으로 계속 간다. 중앙이 없다고 접수 기회를 잃으면 안 된다. (D-18)
    const snapshot =
      input.universityId && (input.requestedFields?.length ?? 0) > 0
        ? await this.vault.fetchSnapshot({
            subjectToken,
            universityId: input.universityId,
            requestedFields: input.requestedFields ?? [],
            // 대학 내부 지원자 UUID 를 중앙에 보내지 않는다. (§A12, D-39)
            // Vault 는 "어느 원서에 무엇을 내줬는지" 만 알면 된다 — 대학 쪽에서 되짚을 수 있는
            // opaque 값이면 충분하다. 전에는 cycleId:applicantId 원문이 그대로 갔다.
            applicationRef: vaultApplicationRef(input.cycleId, input.applicantId),
          })
        : { fields: {}, releasedFields: [], withheldFields: [], available: false };

    return this.db.tx(async (client) => {
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO application
           (id, cycle_id, applicant_id, admission_type_id, department_id, status)
         VALUES ($1,$2,$3,$4,$5,'DRAFT')
         -- 취소된 원서는 자연키에서 빠진다. 착오로 취소한 지원자가 마감 전에
         -- 다시 지원할 수 있어야 한다. (D-29 / 0002 · 0005 마이그레이션)
         ON CONFLICT (cycle_id, applicant_id, admission_type_id)
           WHERE status <> 'CANCELLED'
         DO NOTHING`,
        [id, input.cycleId, input.applicantId, input.admissionTypeId, input.departmentId],
      );

      const row = await this.selectOne(client, {
        cycleId: input.cycleId,
        applicantId: input.applicantId,
        admissionTypeId: input.admissionTypeId,
      });

      const created = inserted.rowCount === 1;
      if (!created && row.departmentId !== input.departmentId) {
        throw ProblemException.oneDepartmentPerAdmissionType();
      }
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

  /**
   * 등록된 지원자의 중앙 가명 토큰. 요청이 다른 토큰을 주장하면 403 — 신원이 섞인 요청이다.
   * 등록되지 않은 지원자면 403 (전에는 외래키 오류로 500 이 났다). 지원자 등록은 본인확인(T-M5-02)의 일이다.
   */
  private async registeredSubjectToken(applicantId: string, claimed?: string): Promise<string> {
    const { rows } = await this.db.query<{ subject_token: string }>(
      `SELECT subject_token FROM applicant WHERE id = $1`,
      [applicantId],
    );
    const registered = rows[0]?.subject_token;
    if (!registered) throw ProblemException.forbidden('등록되지 않은 지원자입니다. 본인확인을 먼저 해 주십시오.');
    if (claimed && claimed !== registered) {
      throw ProblemException.forbidden('지원자 신원 정보가 일치하지 않습니다. 다시 로그인해 주십시오.');
    }
    return registered;
  }

  /** 전형 ID 로 코드(양식 선택 키)를 찾는다. 이 주기의 전형이 아니면 400. */
  async admissionTypeCode(cycleId: string, admissionTypeId: string): Promise<string> {
    const { rows } = await this.db.query<{ code: string }>(
      `SELECT code FROM admission_type WHERE id = $1 AND cycle_id = $2 AND active = true`,
      [admissionTypeId, cycleId],
    );
    if (!rows[0]) throw ProblemException.validationFailed('이 모집에서 선택할 수 없는 전형입니다.');
    return rows[0].code;
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
          current.status === 'PAYMENT_PENDING' || current.status === 'PAID'
            ? '결제를 시작한 원서는 고칠 수 없습니다. 결제가 확인되면 이 내용 그대로 접수됩니다.'
            : `${labelOf(APPLICATION_STATUS_LABEL, current.status)} 상태인 원서는 수정할 수 없습니다.`,
        );
      }
      if (input.admissionTypeId || input.departmentId) {
        await this.assertCatalog(
          client,
          current.cycleId,
          input.admissionTypeId ?? current.admissionTypeId,
          input.departmentId ?? current.departmentId,
        );
      }

      const updated = await client
        .query(
        // 내용이 바뀌면 다시 검증해야 한다 — 검증을 마친 원서(READY)는 작성 중(DRAFT)으로 돌아간다.
        // 상태와 내용을 한 UPDATE 로 바꿔 버전은 한 번만 오른다 (ETag).
        `UPDATE application
            SET admission_type_id = COALESCE($3, admission_type_id),
                department_id     = COALESCE($4, department_id),
                status            = CASE WHEN status = 'READY' THEN 'DRAFT' ELSE status END,
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
      )
        .catch((err: unknown) => {
          // 전형을 바꿨는데 그 전형에 유효한 원서가 이미 있다. 500 이 아니라 규칙 위반이다. (D-29)
          if (isUniqueViolation(err, 'uq_application_active_natural_key')) {
            throw ProblemException.oneDepartmentPerAdmissionType();
          }
          throw err;
        });

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

  /**
   * 최종 검증 결과를 상태에 반영한다. 통과하면 DRAFT → READY, 통과하지 못하면 READY → DRAFT
   * (저장 뒤 설정이 바뀌어 더는 맞지 않는 원서). 다른 상태는 건드리지 않는다.
   * 상태가 바뀌었으면 새 행을 돌려준다 — 화면은 새 ETag 로 이어서 저장해야 한다.
   */
  async markValidated(applicationId: string, valid: boolean): Promise<ApplicationRow | null> {
    return this.db.tx(async (client) => {
      const moved = valid
        ? await transitionApplication(client, applicationId, ['DRAFT'], 'READY')
        : await transitionApplication(client, applicationId, ['READY'], 'DRAFT');
      if (!moved) return null;
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT ${SELECT_COLS} ${FROM_APPLICATION} WHERE a.id = $1`,
        [applicationId],
      );
      return rows[0] ? this.toRow(rows[0]) : null;
    });
  }

  /** 전형·모집단위가 이 주기 소속이고 모집 중(active)인가. 아니면 400 — 고를 수 없는 선택지다. */
  private async assertCatalog(
    q: Queryable,
    cycleId: string,
    admissionTypeId: string,
    departmentId: string,
  ): Promise<void> {
    const { rows } = await q.query<{ type_ok: boolean; dept_ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM admission_type
                       WHERE id = $2 AND cycle_id = $1 AND active = true) AS type_ok,
              EXISTS (SELECT 1 FROM department
                       WHERE id = $3 AND cycle_id = $1 AND active = true) AS dept_ok`,
      [cycleId, admissionTypeId, departmentId],
    );
    const r = rows[0];
    if (!r?.type_ok) throw ProblemException.validationFailed('이 모집에서 선택할 수 없는 전형입니다.');
    if (!r.dept_ok) throw ProblemException.validationFailed('이 모집에서 선택할 수 없는 모집단위입니다.');
  }

  private async selectOne(
    client: PoolClient,
    key: {
      cycleId: string;
      applicantId: string;
      admissionTypeId: string;
    },
  ): Promise<ApplicationRow> {
    const { rows } = await client.query<Record<string, unknown>>(
      // 취소된 원서는 제외한다. 포함하면 재지원 직후 옛 취소 건이 돌아올 수 있다.
      `SELECT ${SELECT_COLS} ${FROM_APPLICATION}
        WHERE a.cycle_id = $1 AND a.applicant_id = $2
          AND a.admission_type_id = $3
          AND a.status <> 'CANCELLED'`,
      [key.cycleId, key.applicantId, key.admissionTypeId],
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

/**
 * Vault 스냅샷 발급 기록에 남길 원서 참조. 소금이 있어 중앙은 되짚을 수 없고,
 * 대학은 같은 입력으로 다시 만들어 대조할 수 있다.
 */
function vaultApplicationRef(cycleId: string, applicantId: string): string {
  return createHash('sha256')
    .update(`${CENTRAL_ID_SALT}|vault-snapshot|${cycleId}|${applicantId}`)
    .digest('hex');
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e.constraint === constraint;
}
