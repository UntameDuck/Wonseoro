import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { commonProfileProblem } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';

export interface SnapshotRequest {
  subjectToken: string;
  universityId: string;
  /** 대학이 필요하다고 선언한 필드. 동의된 것과 교집합만 나간다. */
  requestedFields: string[];
  applicationRef?: string;
}

/** 지원자가 보는 자기 공통원서. */
export interface ApplicantProfile {
  fields: Record<string, unknown>;
  consents: Array<{ universityId: string; universityName: string | null; fieldCodes: string[]; grantedAt: string }>;
  updatedAt: string | null;
}

export class ProfileRejection extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

const UNIVERSITY_ID = /^[A-Za-z0-9_-]{1,32}$/;

export interface SnapshotResult {
  fields: Record<string, unknown>;
  releasedFields: string[];
  /** 대학이 요청했지만 동의가 없어 내보내지 않은 필드. 숨기지 않고 알려준다. */
  withheldFields: string[];
  releasedAt: string;
}

/**
 * Common Profile Vault — 기술설계서 v1.0 §3.1·§5, v1.1 §10 §3
 *
 * ⚠️ API 계약이 노션에 없다. 저장소가 1차 설계했다. (불일치 대장 D-17)
 *
 * **목적 최소화가 이 서비스의 전부다.** (v1.0 §17)
 * 대학이 달라고 한 필드 중 **지원자가 동의한 것만** 내보낸다.
 * 동의 없는 필드는 조용히 빼지 않고 withheld 로 알려준다 —
 * 대학이 "왜 비어 있지"를 추측하게 두면 안 된다.
 *
 * Snapshot 이후는 대학 DB 가 원본이다.
 * 여기를 고쳐도 **이미 접수된 원서는 바뀌지 않는다.** (v1.1 §10 §3)
 */
@Injectable()
export class ProfileVaultService {
  private readonly logger = new Logger(ProfileVaultService.name);

  constructor(private readonly db: Db) {}

  /** 지원자 본인의 공통원서와 대학별 제공 동의. 없으면 빈 공통원서다. */
  async profileOf(subjectToken: string): Promise<ApplicantProfile> {
    const { rows } = await this.db.query<{ fields: Record<string, unknown>; updated_at: Date }>(
      `SELECT fields, updated_at FROM kadmission_vault.applicant_profile WHERE subject_token = $1`,
      [subjectToken],
    );
    const consents = await this.db.query<{ university_id: string; field_codes: string[]; granted_at: Date }>(
      `SELECT university_id, field_codes, granted_at FROM kadmission_vault.profile_release_consent
        WHERE subject_token = $1 AND revoked_at IS NULL
        ORDER BY university_id`,
      [subjectToken],
    );
    // 화면은 대학 이름으로 보인다(T-M5-51, U-22). Vault 표와 JOIN 하지 않고 따로 읽는다 —
    // 운영에서 Vault 는 별도 DB 인스턴스로 나뉜다(0002_vault.sql). 등록부 이름은 공개 정보다.
    const ids = consents.rows.map((c) => c.university_id);
    const names = ids.length
      ? new Map(
          (
            await this.db.query<{ id: string; name: string }>(
              `SELECT id, name FROM kadmission_central.university_registry WHERE id = ANY($1::text[])`,
              [ids],
            )
          ).rows.map((u) => [u.id, u.name]),
        )
      : new Map<string, string>();
    return {
      fields: rows[0]?.fields ?? {},
      consents: consents.rows.map((c) => ({
        universityId: c.university_id,
        universityName: names.get(c.university_id) ?? null,
        fieldCodes: c.field_codes,
        grantedAt: c.granted_at.toISOString(),
      })),
      updatedAt: rows[0]?.updated_at ? rows[0].updated_at.toISOString() : null,
    };
  }

  /**
   * 공통원서 저장 — **통째로 바꾼다(PUT).** 같은 요청을 두 번 보내도 결과가 같다.
   *
   * 동의도 통째로다. 목록에 없는 대학의 동의는 철회된다(revoked_at) — 지우지 않는다.
   * 언제 어느 대학에 무엇을 허락했는지는 사후 검증의 근거다 (v1.0 §8.3).
   * 이미 발급된 Snapshot 은 대학 원서에 복사돼 있어 철회로 사라지지 않는다 (§10 §3).
   * 동의는 저장된 항목에 대해서만 줄 수 있다 — 없는 항목을 허락하는 것은 의미가 없고 오해를 부른다.
   */
  async replaceProfile(
    subjectToken: string,
    fields: unknown,
    consents: unknown,
  ): Promise<ApplicantProfile> {
    const clean = validateFields(fields);
    const grants = validateConsents(consents, new Set(Object.keys(clean)));

    await this.db.tx(async (client) => {
      await client.query(
        `INSERT INTO kadmission_vault.applicant_profile (subject_token, fields)
         VALUES ($1, $2)
         ON CONFLICT (subject_token) DO UPDATE
           SET fields = EXCLUDED.fields, updated_at = now()`,
        [subjectToken, JSON.stringify(clean)],
      );
      for (const g of grants) {
        await client.query(
          `INSERT INTO kadmission_vault.profile_release_consent
             (id, subject_token, university_id, field_codes)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (subject_token, university_id) DO UPDATE
             SET field_codes = EXCLUDED.field_codes, granted_at = now(), revoked_at = NULL`,
          [randomUUID(), subjectToken, g.universityId, g.fieldCodes],
        );
      }
      await client.query(
        `UPDATE kadmission_vault.profile_release_consent
            SET revoked_at = now()
          WHERE subject_token = $1 AND revoked_at IS NULL
            AND NOT (university_id = ANY($2::text[]))`,
        [subjectToken, grants.map((g) => g.universityId)],
      );
    });
    // 값은 남기지 않는다. 몇 개를 저장했는지만.
    this.logger.log(`profile saved: fields=${Object.keys(clean).length} consents=${grants.length}`);
    return this.profileOf(subjectToken);
  }

  /**
   * Snapshot 발급.
   * 요청 필드 ∩ 동의 필드 ∩ 실제 보유 필드 만 나간다.
   */
  async release(req: SnapshotRequest): Promise<SnapshotResult> {
    const { rows } = await this.db.query<{ fields: Record<string, unknown> }>(
      `SELECT fields FROM kadmission_vault.applicant_profile WHERE subject_token = $1`,
      [req.subjectToken],
    );
    const profile = rows[0]?.fields ?? {};

    const consentRows = await this.db.query<{ field_codes: string[] }>(
      `SELECT field_codes FROM kadmission_vault.profile_release_consent
        WHERE subject_token = $1 AND university_id = $2 AND revoked_at IS NULL`,
      [req.subjectToken, req.universityId],
    );
    const consented = new Set(consentRows.rows[0]?.field_codes ?? []);

    const released: Record<string, unknown> = {};
    const releasedFields: string[] = [];
    const withheldFields: string[] = [];

    for (const code of req.requestedFields) {
      if (!consented.has(code)) {
        withheldFields.push(code);
        continue;
      }
      if (!(code in profile)) continue; // 동의는 했지만 값이 없다. 숨길 것도 없다.
      released[code] = profile[code];
      releasedFields.push(code);
    }

    // 값은 남기지 않는다. 무엇을 어디로 보냈는지만 남긴다. (v1.0 §8.3)
    await this.db.query(
      `INSERT INTO kadmission_vault.profile_snapshot_log
         (id, subject_token, university_id, released_fields, application_ref)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        req.subjectToken,
        req.universityId,
        releasedFields,
        req.applicationRef ?? null,
      ],
    );

    if (withheldFields.length > 0) {
      this.logger.log(
        `snapshot to ${req.universityId}: released=${releasedFields.length} withheld=${withheldFields.length}`,
      );
    }

    return {
      fields: released,
      releasedFields,
      withheldFields,
      releasedAt: new Date().toISOString(),
    };
  }
}

/**
 * 공통원서 표준 항목(@wonseoro/contracts COMMON_PROFILE_FIELDS)만, 표준 형식으로만 받는다.
 * 표준에 없는 항목은 어느 대학도 가져가지 않는다 — 저장하면 쓰이지 않는 개인정보만 쌓인다(목적 최소화).
 * 빈 문자열은 "지웠다" 로 본다(저장하지 않는다).
 */
function validateFields(fields: unknown): Record<string, string | number | null> {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new ProfileRejection('fields 는 항목 코드별 값 객체여야 합니다.');
  }
  const out: Record<string, string | number | null> = {};
  for (const [code, value] of Object.entries(fields as Record<string, unknown>)) {
    const problem = commonProfileProblem(code, value);
    if (problem) throw new ProfileRejection(problem);
    if (value === '' || value === null) continue;
    out[code] = value as string | number;
  }
  return out;
}

function validateConsents(
  consents: unknown,
  saved: Set<string>,
): Array<{ universityId: string; fieldCodes: string[] }> {
  if (consents === undefined) return [];
  if (!Array.isArray(consents)) throw new ProfileRejection('consents 는 대학별 동의 배열이어야 합니다.');
  const seen = new Set<string>();
  return consents.map((c) => {
    const { universityId, fieldCodes } = (c ?? {}) as { universityId?: unknown; fieldCodes?: unknown };
    if (typeof universityId !== 'string' || !UNIVERSITY_ID.test(universityId)) {
      throw new ProfileRejection('universityId 가 올바르지 않습니다.');
    }
    if (seen.has(universityId)) throw new ProfileRejection(`같은 대학의 동의가 두 번 있습니다: ${universityId}`);
    seen.add(universityId);
    if (!Array.isArray(fieldCodes) || fieldCodes.some((f) => typeof f !== 'string')) {
      throw new ProfileRejection('fieldCodes 는 항목 코드 배열이어야 합니다.');
    }
    const missing = (fieldCodes as string[]).filter((f) => !saved.has(f));
    if (missing.length > 0) {
      throw new ProfileRejection(`저장하지 않은 항목은 제공에 동의할 수 없습니다: ${missing.join(', ')}`);
    }
    return { universityId, fieldCodes: [...new Set(fieldCodes as string[])] };
  });
}
