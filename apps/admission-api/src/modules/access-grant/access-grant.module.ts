import { Controller, Get, Header, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { AdminGuard } from '../../common/identity/admin.guard';
import { AdminScope } from '../../common/identity/admin-scope';
import { ProblemException } from '../../common/problem/problem.exception';
import type { GrantAction, GrantChangeKind } from './access-grant-events';

/** 화면에 보이는 한 줄 — details 는 허용한 키만 옮긴다(관리자 렐름 ID 등 내부 값은 빼고) */
export interface AccessGrantView {
  seq: number;
  occurredAt: string;
  recordedAt: string;
  action: GrantAction;
  changeKind: GrantChangeKind;
  subject: string;
  /** 대상 계정의 로그인 이름 — 기준·대조 기록에서 마지막으로 본 것 */
  username: string | null;
  roles: string[];
  actor: string | null;
  enabled: boolean | null;
  added: string[];
  removed: string[];
  missing: boolean;
}

export interface AccessGrantPage {
  items: AccessGrantView[];
  /** 다음 쪽(더 오래된 기록)을 받을 때 before 로 넘긴다. 끝이면 null */
  nextBefore: number | null;
  /** 해시 체인을 처음부터 다시 계산한 결과 — 끊김이 없으면 brokenSeq 가 null */
  chain: { checked: number; brokenSeq: number | null };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * 권한 부여·변경·말소 기록 조회 (G-15, D-91) — 보안 감사자 읽기 전용.
 * 담당자 계정 ID·역할 이름뿐이라 개인정보 열람이 아니다(재인증·열람 감사 없음). 기록은 수집 도구만 넣는다.
 */
@Injectable()
export class AccessGrantService {
  constructor(private readonly db: Db) {}

  async list(o: { subject?: string; before?: number; limit: number; unexplainedOnly?: boolean }): Promise<AccessGrantPage> {
    const params: unknown[] = [o.limit + 1];
    const where: string[] = [];
    // 이벤트 없이 바뀐 권한(대조 기록) — 누가 바꿨는지 모르는 변경이라 감사가 먼저 확인한다
    if (o.unexplainedOnly) where.push(`g.change_kind = 'RECONCILED'`);
    if (o.subject) {
      params.push(o.subject);
      where.push(`(g.subject = $${params.length} OR u.username = $${params.length})`);
    }
    if (o.before !== undefined) {
      params.push(o.before);
      where.push(`g.seq < $${params.length}`);
    }
    const { rows } = await this.db.query<{
      seq: string;
      occurred_at: Date;
      recorded_at: Date;
      action: GrantAction;
      change_kind: GrantChangeKind;
      subject: string;
      username: string | null;
      roles: string[];
      actor: string | null;
      details: Record<string, unknown>;
    }>(
      `SELECT g.seq::text, g.occurred_at, g.recorded_at, g.action, g.change_kind, g.subject, u.username, g.roles, g.actor, g.details
         FROM access_grant_log g
         LEFT JOIN LATERAL (
           SELECT l.details->>'username' AS username FROM access_grant_log l
            WHERE l.subject = g.subject AND l.details ? 'username' ORDER BY l.seq DESC LIMIT 1
         ) u ON true
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY g.seq DESC
        LIMIT $1`,
      params,
    );
    const page = rows.slice(0, o.limit);
    const verify = await this.db.query<{ checked: string; broken_seq: string | null }>(
      `SELECT checked::text, broken_seq::text FROM access_grant_log_verify()`,
    );
    const v = verify.rows[0];
    return {
      items: page.map((r) => ({
        seq: Number(r.seq),
        occurredAt: new Date(r.occurred_at).toISOString(),
        recordedAt: new Date(r.recorded_at).toISOString(),
        action: r.action,
        changeKind: r.change_kind,
        subject: r.subject,
        username: r.username,
        roles: r.roles,
        actor: r.actor,
        enabled: typeof r.details.enabled === 'boolean' ? r.details.enabled : null,
        added: strings(r.details.added),
        removed: strings(r.details.removed),
        missing: r.details.missing === true,
      })),
      nextBefore: rows.length > o.limit ? Number(page.at(-1)?.seq) : null,
      chain: { checked: Number(v?.checked ?? 0), brokenSeq: v?.broken_seq ? Number(v.broken_seq) : null },
    };
  }
}

/** 계약: OpenAPI listAccessGrants (D-91). 콘솔 `/access-grants` 가 보여 준다 */
@UseGuards(AdminGuard)
@AdminScope('auditor')
@Controller('admin/v1/access-grants')
export class AccessGrantController {
  constructor(private readonly grants: AccessGrantService) {}

  @Get()
  @Header('cache-control', 'no-store')
  async list(
    @Query('subject') subject?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('unexplained') unexplained?: string,
  ) {
    if (unexplained !== undefined && unexplained !== 'true' && unexplained !== 'false') {
      throw ProblemException.validationFailed('바꾼 사람을 모르는 변경만 볼지를 다시 골라 주십시오.');
    }
    const n = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw ProblemException.validationFailed('한 번에 볼 수 있는 기록은 1~200건입니다.');
    const b = before === undefined ? undefined : Number(before);
    if (b !== undefined && (!Number.isInteger(b) || b < 1)) throw ProblemException.validationFailed('이어서 볼 위치가 올바르지 않습니다.');
    const s = subject?.trim();
    if (s !== undefined && s.length > 200) throw ProblemException.validationFailed('찾을 계정은 200자 이내로 입력해 주십시오.');
    return this.grants.list({ subject: s || undefined, before: b, limit: n, unexplainedOnly: unexplained === 'true' });
  }
}

@Module({
  controllers: [AccessGrantController],
  providers: [AccessGrantService],
})
export class AccessGrantModule {}
