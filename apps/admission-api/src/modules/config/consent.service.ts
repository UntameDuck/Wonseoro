import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { pickConsents, type ApplicationConsent } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { AuditService } from '../audit/audit.service';
import type { ValidationIssue } from './form-schema.service';

export interface ConsentState extends ApplicationConsent {
  /** 이 원서가 지금 판(version)의 문안에 동의했는가 */
  granted: boolean;
}

/** 동의를 바꿀 수 있는 원서 상태 — 결제를 시작하면 원서와 같이 잠긴다 (D-55) */
const EDITABLE = new Set(['DRAFT', 'READY']);

/**
 * 원서 동의 — 문서 10 G-2·G-11, 대장 D-81.
 *
 * 문안은 적용 중 설정의 `consents`(2인 승인)에서 오고, 지원자의 동의는 원서마다 `consent_record` 에
 * (원서, 코드, 판) 하나로 남는다 — 문안 SHA-256 을 같이 둬 "어떤 글에 동의했는가" 를 나중에 증명한다.
 * 필수 동의가 없으면 최종 검증에 오류로 나오고, 결제 전·접수 직전 확인(assertReady)이 거절한다.
 * 문안 판이 바뀌면 옛 판의 동의는 지금 판의 동의로 치지 않는다 — 다시 동의를 받는다.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  async active(cycleId: string): Promise<ApplicationConsent[]> {
    const { rows } = await this.db.query<{ consents: unknown }>(
      `SELECT config_json->'consents' AS consents FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE'
        ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
      [cycleId],
    );
    return pickConsents(rows[0]?.consents);
  }

  async state(applicationId: string, cycleId: string): Promise<ConsentState[]> {
    const consents = await this.active(cycleId);
    if (consents.length === 0) return [];
    const { rows } = await this.db.query<{ consent_code: string; policy_version: string; granted: boolean }>(
      `SELECT consent_code, policy_version, granted FROM consent_record WHERE application_id = $1`,
      [applicationId],
    );
    return consents.map((c) => ({
      ...c,
      granted: rows.some((r) => r.consent_code === c.code && r.policy_version === c.version && r.granted),
    }));
  }

  /** 최종 검증에 더할 오류 — 빠진 필수 동의마다 하나. 경로 `/consents/<코드>` 는 화면이 1단계 동의 칸으로 데려간다 */
  async missingRequired(applicationId: string, cycleId: string): Promise<ValidationIssue[]> {
    return (await this.state(applicationId, cycleId))
      .filter((c) => c.required && !c.granted)
      .map((c) => ({ code: 'CONSENT_REQUIRED', path: `/consents/${c.code}`, message: `${c.title}에 동의해 주십시오.` }));
  }

  /**
   * 동의하거나 거둔다. 원서가 작성 중·작성 완료일 때만 — 결제를 시작하면 바꿀 수 없다.
   * 지금 판에 없는 코드는 400 — 화면이 본 적 없는 문안에 동의할 수 없다.
   */
  async record(input: {
    applicationId: string;
    applicantId: string;
    changes: Array<{ code: string; granted: boolean }>;
    traceId?: string;
    sourceIp?: string;
  }): Promise<ConsentState[]> {
    const { rows } = await this.db.query<{ cycle_id: string }>(`SELECT cycle_id FROM application WHERE id = $1`, [
      input.applicationId,
    ]);
    const cycleId = rows[0]?.cycle_id;
    if (!cycleId) throw ProblemException.validationFailed('존재하지 않는 원서입니다.');
    const consents = await this.active(cycleId);
    const byCode = new Map(consents.map((c) => [c.code, c]));
    if (input.changes.length === 0) throw ProblemException.validationFailed('바꿀 동의를 골라 주십시오.');
    for (const change of input.changes) {
      if (!byCode.has(change.code)) throw ProblemException.validationFailed('지금 받는 동의가 아닙니다. 화면을 새로 고쳐 주십시오.');
    }

    await this.db.tx(async (client) => {
      const locked = await client.query<{ status: string }>(`SELECT status FROM application WHERE id = $1 FOR NO KEY UPDATE`, [
        input.applicationId,
      ]);
      const status = locked.rows[0]?.status ?? '';
      if (!EDITABLE.has(status)) {
        throw ProblemException.versionConflict('결제를 시작한 원서는 동의를 바꿀 수 없습니다.');
      }
      for (const change of input.changes) {
        const c = byCode.get(change.code)!;
        const hash = createHash('sha256').update(c.text).digest('hex');
        await client.query(
          `INSERT INTO consent_record (id, application_id, consent_code, policy_version, granted, granted_at, evidence_hash)
           VALUES ($1,$2,$3,$4,$5,now(),$6)
           ON CONFLICT (application_id, consent_code, policy_version)
           DO UPDATE SET granted = EXCLUDED.granted, granted_at = EXCLUDED.granted_at, evidence_hash = EXCLUDED.evidence_hash`,
          [randomUUID(), input.applicationId, c.code, c.version, change.granted, hash],
        );
        await this.audit.record(client, {
          applicationId: input.applicationId,
          actorType: 'APPLICANT',
          actorId: input.applicantId,
          action: 'CONSENT_RECORDED',
          result: 'ACCEPTED',
          ...(input.traceId ? { traceId: input.traceId } : {}),
          ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
          details: { consentCode: c.code, version: c.version, granted: change.granted, textHash: hash },
        });
      }
    });
    return this.state(input.applicationId, cycleId);
  }
}
