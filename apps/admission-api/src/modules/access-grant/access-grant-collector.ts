/**
 * 권한 변경 기록 수집 (G-15, D-91) — 로그인 서버 관리 이벤트를 옮기고, 실제 권한과 대조한다.
 *
 * 한 번 돌 때:
 *   1. 마지막으로 옮긴 이벤트 시각 5분 전부터 관리 이벤트를 받아 옮긴다(같은 이벤트는 한 줄 — DB 유일 제약)
 *   2. 모든 계정의 지금 권한을 받는다
 *   3. 그 사이 새 이벤트가 생겼으면 1·2 를 다시(최대 3번) — 받는 도중 바뀐 권한을 "어긋남" 으로 잘못 적지 않게
 *   4. 기록으로 복원한 권한과 대조해 처음 보는 계정은 BASELINE, 다르면 RECONCILED 를 남긴다
 *   5. 관리 이벤트(세부 포함)가 꺼져 있으면 대조까지 남긴 뒤 실패로 끝낸다 — 이벤트 없이 바뀐 권한은 누가 바꿨는지 모른다
 *
 * 로그인 서버 이벤트 보관기간(렐름 adminEventsExpiration)보다 자주 돌린다 — 차트 CronJob 은 1시간마다.
 */
import type { Db } from '@wonseoro/server-kit';
import {
  entryFromEvent,
  reconcile,
  stateFromLog,
  type GrantChangeKind,
  type GrantEntry,
  type IdpAccount,
  type IdpAdminEvent,
} from './access-grant-events';
import type { IdpAdmin } from './idp-admin-client';

/** 이미 옮긴 이벤트 시각보다 이만큼 앞부터 다시 받는다 — 같은 밀리초의 이벤트·시계 차이를 놓치지 않게. 겹친 것은 유일 제약이 거른다 */
const OVERLAP_MS = 5 * 60_000;

export interface AccessGrantSyncResult {
  realm: string;
  eventsSeen: number;
  eventsRecorded: number;
  baselines: number;
  reconciled: number;
  accounts: number;
  /** 관리 이벤트(세부 포함)가 켜져 있는가 — 꺼져 있으면 수집 실패 */
  adminEventsEnabled: boolean;
}

type DbLike = Pick<Db, 'query' | 'tx'>;

export class AccessGrantCollector {
  constructor(
    private readonly db: DbLike,
    private readonly idp: IdpAdmin,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sync(): Promise<AccessGrantSyncResult> {
    const config = await this.idp.eventsConfig();
    const enabled = config.adminEventsEnabled && config.adminEventsDetailsEnabled;
    const clients = await this.idp.clients();
    const ctx = { clientIdOf: (uuid: string) => clients.get(uuid), defaultRole: `default-roles-${this.idp.realm}` };

    let eventsSeen = 0;
    let eventsRecorded = 0;
    let accounts: IdpAccount[] = [];
    for (let round = 0; round < 3; round++) {
      const imported = await this.importEvents(ctx);
      eventsSeen += imported.seen;
      eventsRecorded += imported.recorded;
      accounts = await this.idp.accounts();
      const after = await this.idp.adminEvents(imported.latest === null ? null : imported.latest + 1);
      if (!after.some((ev) => entryFromEvent(ev, ctx))) break;
    }

    const logged = stateFromLog(await this.loggedRows());
    const entries = reconcile(accounts, logged, this.now());
    await this.insert(entries);
    return {
      realm: this.idp.realm,
      eventsSeen,
      eventsRecorded,
      baselines: entries.filter((e) => e.changeKind === 'BASELINE').length,
      reconciled: entries.filter((e) => e.changeKind === 'RECONCILED').length,
      accounts: accounts.length,
      adminEventsEnabled: enabled,
    };
  }

  /** 체인 검증 — DB 함수(0011)가 처음부터 다시 계산한다 */
  async verify(): Promise<{ checked: number; brokenSeq: number | null }> {
    const { rows } = await this.db.query<{ checked: string; broken_seq: string | null }>(
      `SELECT checked::text, broken_seq::text FROM access_grant_log_verify()`,
    );
    const r = rows[0];
    return { checked: Number(r?.checked ?? 0), brokenSeq: r?.broken_seq ? Number(r.broken_seq) : null };
  }

  private async importEvents(ctx: Parameters<typeof entryFromEvent>[1]): Promise<{ seen: number; recorded: number; latest: number | null }> {
    const { rows } = await this.db.query<{ latest: Date | null }>(
      `SELECT max(occurred_at) AS latest FROM access_grant_log WHERE source = 'IDP' AND source_event_id LIKE 'idp:%'`,
    );
    const latestLogged = rows[0]?.latest ? new Date(rows[0].latest).getTime() : null;
    const events: IdpAdminEvent[] = await this.idp.adminEvents(latestLogged === null ? null : latestLogged - OVERLAP_MS);
    const entries = events.map((ev) => entryFromEvent(ev, ctx)).filter((e): e is GrantEntry => e !== null);
    const recorded = await this.insert(entries);
    const latest = events.length ? Math.max(...events.map((e) => e.time)) : latestLogged;
    return { seen: events.length, recorded, latest };
  }

  private async loggedRows(): Promise<{ subject: string; changeKind: GrantChangeKind; roles: string[]; details: Record<string, unknown> }[]> {
    const { rows } = await this.db.query<{ subject: string; change_kind: GrantChangeKind; roles: string[]; details: Record<string, unknown> }>(
      `SELECT subject, change_kind, roles, details FROM access_grant_log WHERE source = 'IDP' ORDER BY seq`,
    );
    return rows.map((r) => ({ subject: r.subject, changeKind: r.change_kind, roles: r.roles, details: r.details ?? {} }));
  }

  /** 한 트랜잭션에 시각 순서로 — 이미 있는 이벤트는 건너뛴다. 넣은 줄 수 */
  private async insert(entries: GrantEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const sorted = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return this.db.tx(async (c) => {
      let n = 0;
      for (const e of sorted) {
        const r = await c.query(
          `INSERT INTO access_grant_log (source, source_event_id, occurred_at, action, change_kind, subject, roles, actor, details, row_hash)
           VALUES ('IDP', $1, $2, $3, $4, $5, $6, $7, $8, '')
           ON CONFLICT (source, source_event_id) DO NOTHING`,
          [e.sourceEventId, e.occurredAt, e.action, e.changeKind, e.subject, e.roles, e.actor, JSON.stringify(e.details)],
        );
        n += r.rowCount ?? 0;
      }
      return n;
    });
  }
}
