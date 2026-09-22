import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '@wonseoro/server-kit';

export interface SnapshotRequest {
  subjectToken: string;
  universityId: string;
  /** 대학이 필요하다고 선언한 필드. 동의된 것과 교집합만 나간다. */
  requestedFields: string[];
  applicationRef?: string;
}

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

  async upsertProfile(subjectToken: string, fields: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO kadmission_vault.applicant_profile (subject_token, fields)
       VALUES ($1, $2)
       ON CONFLICT (subject_token) DO UPDATE
         SET fields = EXCLUDED.fields, updated_at = now()`,
      [subjectToken, JSON.stringify(fields)],
    );
  }

  async grantConsent(
    subjectToken: string,
    universityId: string,
    fieldCodes: string[],
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO kadmission_vault.profile_release_consent
         (id, subject_token, university_id, field_codes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (subject_token, university_id) DO UPDATE
         SET field_codes = EXCLUDED.field_codes, granted_at = now(), revoked_at = NULL`,
      [randomUUID(), subjectToken, universityId, fieldCodes],
    );
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
