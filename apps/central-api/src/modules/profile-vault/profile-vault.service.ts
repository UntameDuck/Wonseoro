import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { commonProfileProblem } from '@wonseoro/contracts';
import { Db, FieldKeyUnavailable, fieldKeyRing, openJson, sealJson } from '@wonseoro/server-kit';

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

  /**
   * 공통원서 항목을 푼다 (T-M5-06, 0004_vault_encryption.sql). 공통원서마다 DEK 하나 — 저장할 때마다 새로 만든다(통째로 바꾸는 PUT).
   * DEK 는 `central:vault:profile:<가명 토큰>`, 항목은 `profile:<가명 토큰>` 에 묶는다 — 다른 지원자 행으로 옮겨 붙이면 풀리지 않는다.
   * 키를 쓸 수 없으면 FieldKeyUnavailable(503) — 빈 공통원서로 대신하지 않는다(대학에 "동의 없음" 으로 잘못 나간다)
   */
  private async readFields(subjectToken: string): Promise<{ fields: Record<string, unknown>; updatedAt: Date | null }> {
    const { rows } = await this.db.query<{
      fields: Record<string, unknown>;
      fields_ciphertext: Buffer | null;
      wrapped_dek: Buffer | null;
      key_version: string;
      updated_at: Date;
    }>(
      `SELECT fields, fields_ciphertext, wrapped_dek, key_version, updated_at
         FROM kadmission_vault.applicant_profile WHERE subject_token = $1`,
      [subjectToken],
    );
    const r = rows[0];
    if (!r) return { fields: {}, updatedAt: null };
    if (!r.fields_ciphertext || !r.wrapped_dek) return { fields: r.fields ?? {}, updatedAt: r.updated_at };
    try {
      const dek = await fieldKeyRing().unwrap(r.key_version, r.wrapped_dek, `central:vault:profile:${subjectToken}`);
      return { fields: openJson(dek, r.fields_ciphertext, `profile:${subjectToken}`) as Record<string, unknown>, updatedAt: r.updated_at };
    } catch (err) {
      if (err instanceof FieldKeyUnavailable) {
        this.logger.error(`공통원서 키를 쓸 수 없다 — ${err.reason}`);
        throw new HttpException(
          {
            type: 'https://wonseoro.kr/problems/retryable',
            title: '일시적인 오류입니다. 다시 시도해 주십시오',
            status: 503,
            code: 'RETRYABLE',
            traceId: '',
            detail: '지금은 공통원서를 불러올 수 없습니다. 잠시 후 다시 시도해 주십시오.',
          },
          503,
        );
      }
      throw err;
    }
  }

  /** KEK 교체 뒤 — 옛 KEK 로 감싼 DEK 를 현재 KEK 로 다시 감싼다(값은 그대로). 바꾼 개수 */
  async rewrapKeys(from?: string, batch = 500): Promise<number> {
    const ring = fieldKeyRing();
    const { rows } = await this.db.query<{ subject_token: string; key_version: string; wrapped_dek: Buffer }>(
      `SELECT subject_token, key_version, wrapped_dek FROM kadmission_vault.applicant_profile
        WHERE key_version NOT IN ($1, 'plaintext-dev') AND ($3::text IS NULL OR key_version = $3)
        ORDER BY subject_token LIMIT $2`,
      [ring.activeId, batch, from ?? null],
    );
    for (const r of rows) {
      const aad = `central:vault:profile:${r.subject_token}`;
      const { kekId, wrapped } = await ring.wrap(await ring.unwrap(r.key_version, r.wrapped_dek, aad), aad);
      await this.db.query(
        `UPDATE kadmission_vault.applicant_profile SET key_version = $2, wrapped_dek = $3 WHERE subject_token = $1 AND key_version = $4`,
        [r.subject_token, kekId, wrapped, r.key_version],
      );
    }
    return rows.length;
  }

  /** 0004 이전 평문 공통원서를 암호문으로 옮긴다. 옮긴 개수 */
  async encryptLegacy(batch = 500): Promise<number> {
    const { rows } = await this.db.query<{ subject_token: string; fields: Record<string, unknown> }>(
      `SELECT subject_token, fields FROM kadmission_vault.applicant_profile
        WHERE key_version = 'plaintext-dev' ORDER BY subject_token LIMIT $1`,
      [batch],
    );
    for (const r of rows) {
      const dek = randomBytes(32);
      const { kekId, wrapped } = await fieldKeyRing().wrap(dek, `central:vault:profile:${r.subject_token}`);
      await this.db.query(
        `UPDATE kadmission_vault.applicant_profile
            SET fields = '{}'::jsonb, fields_ciphertext = $2, wrapped_dek = $3, key_version = $4
          WHERE subject_token = $1 AND key_version = 'plaintext-dev'`,
        [r.subject_token, sealJson(dek, r.fields ?? {}, `profile:${r.subject_token}`), wrapped, kekId],
      );
    }
    return rows.length;
  }

  /** 지원자 본인의 공통원서와 대학별 제공 동의. 없으면 빈 공통원서다. */
  async profileOf(subjectToken: string): Promise<ApplicantProfile> {
    const stored = await this.readFields(subjectToken);
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
      fields: stored.fields,
      consents: consents.rows.map((c) => ({
        universityId: c.university_id,
        universityName: names.get(c.university_id) ?? null,
        fieldCodes: c.field_codes,
        grantedAt: c.granted_at.toISOString(),
      })),
      updatedAt: stored.updatedAt ? stored.updatedAt.toISOString() : null,
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

    // 통째로 바꾸므로 DEK 도 저장마다 새로 — 옛 DEK 로 봉한 값이 남지 않는다
    const dek = randomBytes(32);
    const { kekId, wrapped } = await fieldKeyRing().wrap(dek, `central:vault:profile:${subjectToken}`);
    const sealed = sealJson(dek, clean, `profile:${subjectToken}`);

    await this.db.tx(async (client) => {
      await client.query(
        `INSERT INTO kadmission_vault.applicant_profile (subject_token, fields, fields_ciphertext, wrapped_dek, key_version)
         VALUES ($1, '{}'::jsonb, $2, $3, $4)
         ON CONFLICT (subject_token) DO UPDATE
           SET fields = '{}'::jsonb, fields_ciphertext = EXCLUDED.fields_ciphertext, wrapped_dek = EXCLUDED.wrapped_dek,
               key_version = EXCLUDED.key_version, updated_at = now()`,
        [subjectToken, sealed, wrapped, kekId],
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
    const profile = (await this.readFields(req.subjectToken)).fields;

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
