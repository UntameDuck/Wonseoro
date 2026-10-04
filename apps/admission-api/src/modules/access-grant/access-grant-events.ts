/**
 * 접근 권한 부여·변경·말소 기록 (개인정보의 안전성 확보조치 기준 제5조 ③ — 최소 3년, 문서 10 G-15, 대장 D-91)
 *
 * 담당자 권한의 원본은 로그인 서버(담당자 렐름)다. 여기서는 그 관리 이벤트를 기록 한 줄로 바꾸고(`entryFromEvent`),
 * 기록을 처음부터 따라가 계정별 권한을 복원하며(`stateFromLog`), 실제 권한과 어긋나면 대조 기록을 만든다(`reconcile`).
 * 관리 이벤트가 꺼져 있었거나 로그인 서버의 보관기간이 지나 빠진 변경도 대조가 잡는다 — 기록이 실제와 다른 채로 남지 않는다.
 *
 * 개인정보를 옮기지 않는다 — 계정 ID·로그인 이름·역할 이름·바꾼 관리자 계정 ID 만. 이벤트 본문의 이름·이메일·IP 는 버린다.
 */

/** 로그인 서버(Keycloak) 관리 이벤트 — 쓰는 칸만 */
export interface IdpAdminEvent {
  id?: string;
  time: number;
  authDetails?: { realmId?: string; userId?: string };
  operationType: string;
  resourceType: string;
  resourcePath?: string;
  representation?: string;
}

export type GrantAction = 'BASELINE' | 'GRANT' | 'CHANGE' | 'REVOKE';
export type GrantChangeKind =
  | 'BASELINE'
  | 'RECONCILED'
  | 'ROLE_ADDED'
  | 'ROLE_REMOVED'
  | 'GROUP_JOINED'
  | 'GROUP_LEFT'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_DELETED'
  | 'ROLE_DEFINITION_CHANGED';

/** 기록 한 줄 (0011 access_grant_log) — 순번·해시·기록 시각은 DB 가 매긴다 */
export interface GrantEntry {
  sourceEventId: string;
  occurredAt: Date;
  action: GrantAction;
  changeKind: GrantChangeKind;
  subject: string;
  roles: string[];
  actor: string | null;
  details: Record<string, unknown>;
}

/** 지금 로그인 서버에 있는 계정과 그 권한 — 직접 받은 렐름 역할·클라이언트 역할(<클라이언트>:<역할>)·그룹(group:<경로>) */
export interface IdpAccount {
  id: string;
  username: string;
  enabled: boolean;
  roles: string[];
}

export interface EventContext {
  /** 클라이언트 내부 ID → clientId. 모르면 내부 ID 를 그대로 쓴다 */
  clientIdOf: (uuid: string) => string | undefined;
  /** 렐름 기본 역할(default-roles-<렐름>) — 모든 계정이 자동으로 받는 것이라 기록에서 뺀다 */
  defaultRole: string;
}

interface RoleRep {
  name?: string;
  clientRole?: boolean;
  containerId?: string;
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function roleNames(rep: unknown, ctx: EventContext): string[] {
  const list = Array.isArray(rep) ? (rep as RoleRep[]) : [];
  return list
    .map((r) => {
      if (!r?.name) return null;
      if (r.clientRole) return `${(r.containerId && ctx.clientIdOf(r.containerId)) ?? r.containerId ?? '?'}:${r.name}`;
      return r.name;
    })
    .filter((n): n is string => !!n && n !== ctx.defaultRole)
    .sort();
}

/** 이벤트 ID 가 없는 옛 서버는 시각·경로·동작으로 만든다 — 같은 이벤트를 다시 읽어도 같은 값 */
export function eventKey(ev: IdpAdminEvent): string {
  return ev.id ? `idp:${ev.id}` : `idp:${ev.time}:${ev.operationType}:${ev.resourcePath ?? ''}`;
}

/** 관리 이벤트 → 기록 한 줄. 권한과 관계없는 이벤트(비밀번호 재설정·클라이언트 설정 등)는 null */
export function entryFromEvent(ev: IdpAdminEvent, ctx: EventContext): GrantEntry | null {
  const path = ev.resourcePath ?? '';
  const op = ev.operationType;
  if (op !== 'CREATE' && op !== 'UPDATE' && op !== 'DELETE') return null;
  const actor = ev.authDetails?.userId;
  if (!actor) return null;
  const base = {
    sourceEventId: eventKey(ev),
    occurredAt: new Date(ev.time),
    actor,
    details: ev.authDetails?.realmId ? { actorRealm: ev.authDetails.realmId } : {},
  };
  const rep = parseJson(ev.representation);
  const seg = path.split('/');

  switch (ev.resourceType) {
    case 'REALM_ROLE_MAPPING':
    case 'CLIENT_ROLE_MAPPING': {
      if (op === 'UPDATE') return null;
      const subject = seg[0] === 'users' && seg[1] ? seg[1] : seg[0] === 'groups' && seg[1] ? `group:${seg[1]}` : null;
      const roles = roleNames(rep, ctx);
      if (!subject || roles.length === 0) return null;
      return {
        ...base,
        action: op === 'CREATE' ? 'GRANT' : 'REVOKE',
        changeKind: op === 'CREATE' ? 'ROLE_ADDED' : 'ROLE_REMOVED',
        subject,
        roles,
      };
    }
    case 'GROUP_MEMBERSHIP': {
      if (seg[0] !== 'users' || !seg[1] || seg[2] !== 'groups' || op === 'UPDATE') return null;
      const g = (rep ?? {}) as { path?: string; name?: string };
      const group = `group:${g.path ?? (g.name ? `/${g.name}` : seg[3] ?? '?')}`;
      return {
        ...base,
        action: op === 'CREATE' ? 'GRANT' : 'REVOKE',
        changeKind: op === 'CREATE' ? 'GROUP_JOINED' : 'GROUP_LEFT',
        subject: seg[1],
        roles: [group],
      };
    }
    case 'USER': {
      // 계정 자체(users/<ID>)만 — 하위 경로(비밀번호·OTP·세션)는 권한이 아니다
      if (seg[0] !== 'users' || !seg[1] || seg.length !== 2) return null;
      const enabled = (rep as { enabled?: unknown } | undefined)?.enabled;
      const detail = typeof enabled === 'boolean' ? { ...base.details, enabled } : base.details;
      if (op === 'CREATE') return { ...base, details: detail, action: 'GRANT', changeKind: 'ACCOUNT_CREATED', subject: seg[1], roles: [] };
      if (op === 'DELETE') return { ...base, action: 'REVOKE', changeKind: 'ACCOUNT_DELETED', subject: seg[1], roles: [] };
      return enabled === false
        ? { ...base, details: detail, action: 'REVOKE', changeKind: 'ACCOUNT_DISABLED', subject: seg[1], roles: [] }
        : { ...base, details: detail, action: 'CHANGE', changeKind: 'ACCOUNT_UPDATED', subject: seg[1], roles: [] };
    }
    case 'REALM_ROLE':
    case 'CLIENT_ROLE': {
      // 역할 정의(복합 역할 구성 포함)가 바뀌면 그 역할을 가진 모든 계정의 권한이 바뀐다
      const composites = path.endsWith('/composites') ? roleNames(rep, ctx) : [];
      return { ...base, action: 'CHANGE', changeKind: 'ROLE_DEFINITION_CHANGED', subject: `role:${path}`, roles: composites };
    }
    default:
      return null;
  }
}

export interface AccountState {
  roles: Set<string>;
  enabled: boolean;
}

export interface LoggedRow {
  subject: string;
  changeKind: GrantChangeKind;
  roles: string[];
  details: Record<string, unknown>;
}

/** 기록을 순번대로 따라가 계정별 권한을 복원한다 — 그룹·역할 정의 줄은 계정 상태가 아니라 건너뛴다 */
export function stateFromLog(rows: Iterable<LoggedRow>): Map<string, AccountState> {
  const state = new Map<string, AccountState>();
  for (const r of rows) {
    if (r.subject.startsWith('group:') || r.subject.startsWith('role:')) continue;
    const enabledIn = typeof r.details.enabled === 'boolean' ? r.details.enabled : undefined;
    const cur = state.get(r.subject);
    switch (r.changeKind) {
      case 'BASELINE':
      case 'RECONCILED':
        if (r.details.missing === true) state.delete(r.subject);
        else state.set(r.subject, { roles: new Set(r.roles), enabled: enabledIn ?? cur?.enabled ?? true });
        break;
      case 'ACCOUNT_CREATED':
        state.set(r.subject, { roles: cur?.roles ?? new Set(), enabled: enabledIn ?? true });
        break;
      case 'ACCOUNT_DELETED':
        state.delete(r.subject);
        break;
      case 'ACCOUNT_DISABLED':
      case 'ACCOUNT_UPDATED':
        if (cur && enabledIn !== undefined) cur.enabled = enabledIn;
        break;
      // 기준(또는 계정 생성) 전의 부여·회수만으로는 그 계정의 전체 권한을 모른다 — 상태를 만들지 않고, 대조가 기준을 남기게 한다
      case 'ROLE_ADDED':
      case 'GROUP_JOINED':
        if (cur) for (const role of r.roles) cur.roles.add(role);
        break;
      case 'ROLE_REMOVED':
      case 'GROUP_LEFT':
        if (cur) for (const role of r.roles) cur.roles.delete(role);
        break;
      default:
        break;
    }
  }
  return state;
}

/**
 * 실제 권한과 복원한 권한을 대조한다.
 *   처음 보는 계정 → BASELINE(그 시각의 전체 권한)
 *   다르면 → RECONCILED(실제 전체 권한, 더해진·빠진 것·사용 여부 변화를 details 에)
 *   기록에는 있는데 로그인 서버에 없으면 → RECONCILED·REVOKE(missing)
 */
export function reconcile(actual: readonly IdpAccount[], logged: Map<string, AccountState>, runAt: Date): GrantEntry[] {
  const out: GrantEntry[] = [];
  const stamp = runAt.toISOString();
  const seen = new Set<string>();
  for (const a of actual) {
    seen.add(a.id);
    const roles = [...new Set(a.roles)].sort();
    const prev = logged.get(a.id);
    if (!prev) {
      out.push({
        sourceEventId: `baseline:${stamp}:${a.id}`,
        occurredAt: runAt,
        action: 'BASELINE',
        changeKind: 'BASELINE',
        subject: a.id,
        roles,
        actor: null,
        details: { username: a.username, enabled: a.enabled },
      });
      continue;
    }
    const added = roles.filter((r) => !prev.roles.has(r));
    const removed = [...prev.roles].filter((r) => !roles.includes(r)).sort();
    if (added.length === 0 && removed.length === 0 && prev.enabled === a.enabled) continue;
    out.push({
      sourceEventId: `reconcile:${stamp}:${a.id}`,
      occurredAt: runAt,
      action: !a.enabled && prev.enabled ? 'REVOKE' : added.length > 0 && removed.length === 0 ? 'GRANT' : removed.length > 0 && added.length === 0 ? 'REVOKE' : 'CHANGE',
      changeKind: 'RECONCILED',
      subject: a.id,
      roles,
      actor: null,
      details: { username: a.username, enabled: a.enabled, enabledBefore: prev.enabled, added, removed },
    });
  }
  for (const [subject, prev] of logged) {
    if (seen.has(subject)) continue;
    out.push({
      sourceEventId: `reconcile:${stamp}:${subject}`,
      occurredAt: runAt,
      action: 'REVOKE',
      changeKind: 'RECONCILED',
      subject,
      roles: [],
      actor: null,
      details: { missing: true, removed: [...prev.roles].sort() },
    });
  }
  return out;
}
