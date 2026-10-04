/**
 * 로그인 서버(Keycloak) 관리 API 읽기 — 권한 변경 기록 수집(G-15, D-91) 전용.
 *
 * 수집 클라이언트(렐름의 `access-grant-collector`, 서비스 계정)는 읽기 권한만 있다 — view-events·view-users·view-realm·view-clients
 * (클라이언트 역할 이름을 <클라이언트>:<역할> 로 적으려면 클라이언트 목록이 필요하다).
 * 요청은 모두 출구 허용 목록을 거친다(`egressHttp`) — 부르는 쪽이 발급자 주소를 `configureEgress` 에 넣는다.
 */
import { egressHttp } from '@wonseoro/server-kit';
import type { IdpAccount, IdpAdminEvent } from './access-grant-events';

/** 수집에 쓰는 것 — 시험은 가짜로 바꾼다 */
export interface IdpAdmin {
  readonly realm: string;
  eventsConfig(): Promise<{ adminEventsEnabled: boolean; adminEventsDetailsEnabled: boolean }>;
  /** sinceMs 이후(포함)의 관리 이벤트 전부, 시각 오름차순 */
  adminEvents(sinceMs: number | null): Promise<IdpAdminEvent[]>;
  /** 클라이언트 내부 ID → clientId */
  clients(): Promise<Map<string, string>>;
  /** 모든 계정과 직접 받은 권한 */
  accounts(): Promise<IdpAccount[]>;
}

export interface KeycloakAdminOptions {
  /** 담당자 렐름 발급자 주소 — http(s)://<호스트>[/<앞 경로>]/realms/<렐름> */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** 한 번에 받는 수 */
  pageSize?: number;
}

export class IdpAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdpAdminError';
  }
}

const RESOURCE_TYPES = ['REALM_ROLE_MAPPING', 'CLIENT_ROLE_MAPPING', 'GROUP_MEMBERSHIP', 'USER', 'REALM_ROLE', 'CLIENT_ROLE'];

export class KeycloakAdmin implements IdpAdmin {
  readonly realm: string;
  private readonly base: string;
  private readonly tokenUrl: string;
  private readonly pageSize: number;
  private token: { value: string; until: number } | null = null;

  constructor(private readonly o: KeycloakAdminOptions) {
    const u = new URL(o.issuer);
    const m = /^(.*)\/realms\/([^/]+)\/?$/.exec(u.pathname);
    if (!m) throw new IdpAdminError('발급자 주소가 …/realms/<렐름> 형식이 아니다');
    this.realm = decodeURIComponent(m[2] as string);
    this.base = `${u.origin}${m[1]}/admin/realms/${encodeURIComponent(this.realm)}`;
    this.tokenUrl = `${u.origin}${m[1]}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/token`;
    this.pageSize = o.pageSize ?? 200;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await egressHttp().fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.o.clientId, client_secret: this.o.clientSecret }).toString(),
    });
    if (!res.ok) throw new IdpAdminError(`수집 클라이언트 토큰을 받지 못했다 (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new IdpAdminError('수집 클라이언트 토큰 응답에 토큰이 없다');
    // 만료 30초 전에 새로 받는다
    this.token = { value: body.access_token, until: Date.now() + Math.max(10, (body.expires_in ?? 60) - 30) * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await egressHttp().fetch(url.toString(), { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } });
    if (!res.ok) throw new IdpAdminError(`로그인 서버 관리 API ${path.split('/')[0]} 응답 ${res.status}`);
    return (await res.json()) as T;
  }

  /** 없으면(서비스 계정을 켜지 않은 클라이언트 — 400/404) null */
  private async getOptional<T>(path: string): Promise<T | null> {
    const res = await egressHttp().fetch(`${this.base}/${path}`, { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } });
    if (res.status === 400 || res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) throw new IdpAdminError(`로그인 서버 관리 API ${path.split('/')[0]} 응답 ${res.status}`);
    return (await res.json()) as T;
  }

  eventsConfig(): Promise<{ adminEventsEnabled: boolean; adminEventsDetailsEnabled: boolean }> {
    return this.get('events/config');
  }

  async adminEvents(sinceMs: number | null): Promise<IdpAdminEvent[]> {
    const all = new Map<string, IdpAdminEvent>();
    for (const type of RESOURCE_TYPES) {
      for (let first = 0; ; first += this.pageSize) {
        const page = await this.get<IdpAdminEvent[]>('admin-events', {
          resourceTypes: type,
          dateFrom: sinceMs === null ? undefined : sinceMs,
          first,
          max: this.pageSize,
        });
        for (const ev of page) all.set(ev.id ?? `${ev.time}:${ev.operationType}:${ev.resourcePath}`, ev);
        if (page.length < this.pageSize) break;
      }
    }
    return [...all.values()].sort((a, b) => a.time - b.time);
  }

  async clients(): Promise<Map<string, string>> {
    const list = await this.get<{ id: string; clientId: string }[]>('clients', { briefRepresentation: 'true', max: 1000 });
    return new Map(list.map((c) => [c.id, c.clientId]));
  }

  async accounts(): Promise<IdpAccount[]> {
    const defaultRole = `default-roles-${this.realm}`;
    const users: { id: string; username: string; enabled: boolean }[] = [];
    for (let first = 0; ; first += this.pageSize) {
      const page = await this.get<{ id: string; username: string; enabled: boolean }[]>('users', { first, max: this.pageSize, briefRepresentation: 'true' });
      users.push(...page);
      if (page.length < this.pageSize) break;
    }
    // 계정 목록은 서비스 계정을 숨긴다 — 클라이언트마다 서비스 계정을 따로 묻는다(로그인 서버 관리 권한을 가진 서비스 계정도 접근 권한이다)
    const seen = new Set(users.map((u) => u.id));
    for (const clientUuid of (await this.clients()).keys()) {
      const sa = await this.getOptional<{ id: string; username: string; enabled: boolean }>(`clients/${encodeURIComponent(clientUuid)}/service-account-user`);
      if (sa && !seen.has(sa.id)) {
        seen.add(sa.id);
        users.push(sa);
      }
    }
    const out: IdpAccount[] = [];
    for (const u of users) {
      const id = encodeURIComponent(u.id);
      const mappings = await this.get<{
        realmMappings?: { name: string }[];
        clientMappings?: Record<string, { client: string; mappings: { name: string }[] }>;
      }>(`users/${id}/role-mappings`);
      const groups = await this.get<{ path?: string; name: string }[]>(`users/${id}/groups`, { briefRepresentation: 'true' });
      const roles = [
        ...(mappings.realmMappings ?? []).map((r) => r.name).filter((n) => n !== defaultRole),
        ...Object.values(mappings.clientMappings ?? {}).flatMap((c) => c.mappings.map((r) => `${c.client}:${r.name}`)),
        ...groups.map((g) => `group:${g.path ?? `/${g.name}`}`),
      ];
      out.push({ id: u.id, username: u.username, enabled: u.enabled !== false, roles: [...new Set(roles)].sort() });
    }
    return out;
  }
}
