import { createHash, randomUUID } from 'node:crypto';
import { pickConsents } from '@wonseoro/contracts';
import type { Db } from '@wonseoro/server-kit';

/**
 * **시험 전용** — 적용 중 설정의 원서 동의(G-2, D-81)를 모두 한 것으로 남긴다.
 * 결제·접수 흐름을 보는 시험이 동의 단계를 거치지 않아도 되게 한다. 동의 자체는 consent.integration 시험이 본다.
 */
export async function grantActiveConsents(db: Db, applicationId: string, cycleId: string): Promise<void> {
  const { rows } = await db.query<{ consents: unknown }>(
    `SELECT config_json->'consents' AS consents FROM config_version
      WHERE cycle_id = $1 AND status = 'ACTIVE' ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
    [cycleId],
  );
  for (const c of pickConsents(rows[0]?.consents)) {
    await db.query(
      `INSERT INTO consent_record (id, application_id, consent_code, policy_version, granted, granted_at, evidence_hash)
       VALUES ($1,$2,$3,$4,true,now(),$5)
       ON CONFLICT (application_id, consent_code, policy_version) DO NOTHING`,
      [randomUUID(), applicationId, c.code, c.version, createHash('sha256').update(c.text).digest('hex')],
    );
  }
}
