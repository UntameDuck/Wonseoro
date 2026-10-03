import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 발급자 서명 키(JWKS) 캐시 — T-M3-06 Local JWKS Cache, T-M5-02
 *
 * 왜 직접 두나
 *   중앙 IAM(발급자)이 끊겨도 **이미 로그인한 사람의 접수는 계속되어야 한다**(§01 A1 Autonomous Mode).
 *   토큰 검증에 필요한 것은 발급자의 공개키뿐이다. 마지막으로 받은 키를 들고 있다가 발급자가 죽어도 그 키로
 *   계속 검증한다. 라이브러리의 원격 키 묶음은 이 동작을 약속하지 않는다.
 *
 * 규칙
 *   - 키가 `refreshIntervalMs` 보다 오래되면 뒤에서 다시 받는다. 실패해도 쓰던 키를 버리지 않는다
 *   - 모르는 `kid` 가 오면(키 교체) 바로 다시 받는다. 단 `unknownKidCooldownMs` 안에는 한 번만 —
 *     아무 kid 나 붙인 위조 토큰을 쏟아부어 발급자를 두드리게 만들 수 없다. 동시에 온 요청은 한 번의 요청을 같이 기다린다
 *   - 마지막 성공이 `maxStaleMs` 보다 오래되면 키를 쓰지 않는다(닫힌 실패). 무한정 옛 키를 믿지 않는다
 *   - `snapshotFile` 이 있으면 받은 공개키를 파일에 남기고, 기동 때 발급자가 죽어 있으면 그 파일로 시작한다
 *     (Pod 가 발급자 장애 중에 다시 떠도 검증이 이어진다). 공개키뿐이라 비밀이 아니다
 */

export interface PublicJwk {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

export interface JwksCacheOptions {
  /** 발급자 주소. discovery(`/.well-known/openid-configuration`)로 jwks_uri 를 찾는다 */
  issuer: string;
  /** 알고 있으면 discovery 를 건너뛴다 */
  jwksUri?: string;
  fetch?: typeof fetch;
  now?: () => number;
  refreshIntervalMs?: number;
  unknownKidCooldownMs?: number;
  maxStaleMs?: number;
  snapshotFile?: string;
  timeoutMs?: number;
}

export interface JwksCacheStatus {
  /** 지금 쓰는 키의 출처 */
  source: 'issuer' | 'snapshot' | 'none';
  keyCount: number;
  /** 마지막으로 발급자에서 받은 시각(스냅숏이면 스냅숏이 받은 시각) */
  fetchedAt: number | null;
  ageMs: number | null;
  /** maxStaleMs 를 넘겨 키를 쓰지 않는 중 */
  expired: boolean;
  lastError: string | null;
  refreshes: number;
  /** 마지막으로 발급자에 닿아 보려 한 결과 — 단절 유예(OidcVerifier `outageGraceMs`)가 본다 */
  issuerReachable: boolean | null;
}

interface Snapshot {
  issuer: string;
  jwksUri: string;
  fetchedAt: number;
  keys: PublicJwk[];
}

/** 비밀 키 성분 — 발급자가 실수로 섞어 보내도 들고 있지 않는다 */
const PRIVATE_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

function publicSigningKeys(raw: unknown): PublicJwk[] {
  const keys = (raw as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) throw new Error('JWKS 형식이 아니다(keys 배열 없음)');
  return keys
    .filter((k): k is PublicJwk => !!k && typeof k === 'object' && typeof (k as PublicJwk).kid === 'string' && typeof (k as PublicJwk).kty === 'string')
    .filter((k) => k.use === undefined || k.use === 'sig')
    .filter((k) => !PRIVATE_FIELDS.some((f) => f in k));
}

export class JwksCache {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly refreshIntervalMs: number;
  private readonly unknownKidCooldownMs: number;
  private readonly maxStaleMs: number;
  private readonly timeoutMs: number;

  private keys = new Map<string, PublicJwk>();
  private source: JwksCacheStatus['source'] = 'none';
  private fetchedAt: number | null = null;
  private jwksUri: string | undefined;
  private lastError: string | null = null;
  private lastUnknownKidRefresh = Number.NEGATIVE_INFINITY;
  private lastExpiredRefresh = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<boolean> | null = null;
  private started: Promise<void> | null = null;
  private refreshes = 0;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private lastAttemptOk: boolean | null = null;

  constructor(private readonly o: JwksCacheOptions) {
    this.fetchFn = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.refreshIntervalMs = o.refreshIntervalMs ?? 10 * 60_000;
    this.unknownKidCooldownMs = o.unknownKidCooldownMs ?? 30_000;
    this.maxStaleMs = o.maxStaleMs ?? 24 * 60 * 60_000;
    this.timeoutMs = o.timeoutMs ?? 3_000;
    this.jwksUri = o.jwksUri;
  }

  /** 첫 사용 때 한 번 — 발급자에서 받고, 안 되면 스냅숏으로 시작한다 */
  private ensureStarted(): Promise<void> {
    this.started ??= (async () => {
      const ok = await this.refresh();
      if (!ok) this.loadSnapshot();
    })();
    return this.started;
  }

  /** kid 에 맞는 공개키. 없거나 키가 너무 오래됐으면 undefined */
  async key(kid: string): Promise<PublicJwk | undefined> {
    await this.ensureStarted();
    if (this.isExpired()) {
      // 오래된 키는 쓰지 않는다. 다시 받아 보고, 안 되면 닫힌 실패. 발급자가 죽어 있을 때 요청마다 두드리지 않게
      // 다시 받기는 쿨다운에 한 번이다
      if (this.now() - this.lastExpiredRefresh >= this.unknownKidCooldownMs) {
        this.lastExpiredRefresh = this.now();
        await this.refresh();
      }
      return this.isExpired() ? undefined : this.keys.get(kid);
    }
    const age = this.fetchedAt === null ? Infinity : this.now() - this.fetchedAt;
    if (age > this.refreshIntervalMs) void this.refresh();

    const hit = this.keys.get(kid);
    if (hit) return hit;
    if (this.now() - this.lastUnknownKidRefresh < this.unknownKidCooldownMs) return undefined;
    this.lastUnknownKidRefresh = this.now();
    await this.refresh();
    return this.keys.get(kid);
  }

  status(): JwksCacheStatus {
    return {
      source: this.source,
      keyCount: this.keys.size,
      fetchedAt: this.fetchedAt,
      ageMs: this.fetchedAt === null ? null : this.now() - this.fetchedAt,
      expired: this.isExpired(),
      lastError: this.lastError,
      refreshes: this.refreshes,
      issuerReachable: this.lastAttemptOk,
    };
  }

  /**
   * 발급자가 지금 닿는가 — 키를 다시 받아 본다. 쿨다운(`unknownKidCooldownMs`) 안이면 직전 결과를 쓴다.
   * 만료 토큰을 단절 유예로 받을지 정할 때만 부른다 — 만료 토큰을 쏟아부어도 발급자를 쿨다운에 한 번만 두드린다
   */
  async issuerReachable(): Promise<boolean> {
    await this.ensureStarted();
    if (this.lastAttemptOk !== null && this.now() - this.lastAttemptAt < this.unknownKidCooldownMs) return this.lastAttemptOk;
    return this.refresh();
  }

  private isExpired(): boolean {
    return this.fetchedAt === null || this.now() - this.fetchedAt > this.maxStaleMs;
  }

  /** 발급자에서 다시 받는다. 동시에 부르면 한 번의 요청을 같이 기다린다. 실패하면 쓰던 키를 그대로 둔다 */
  refresh(): Promise<boolean> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<boolean> {
    this.refreshes += 1;
    this.lastAttemptAt = this.now();
    try {
      const jwksUri = this.jwksUri ?? (await this.discover());
      const keys = publicSigningKeys(await this.getJson(jwksUri));
      if (keys.length === 0) throw new Error('서명 키가 없다');
      this.jwksUri = jwksUri;
      this.keys = new Map(keys.map((k) => [k.kid, k]));
      this.fetchedAt = this.now();
      this.source = 'issuer';
      this.lastError = null;
      this.lastAttemptOk = true;
      this.saveSnapshot({ issuer: this.o.issuer, jwksUri, fetchedAt: this.fetchedAt, keys });
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastAttemptOk = false;
      return false;
    }
  }

  private async discover(): Promise<string> {
    const meta = (await this.getJson(`${this.o.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)) as {
      issuer?: string;
      jwks_uri?: string;
    };
    // 다른 발급자의 메타데이터를 받으면(설정 실수·가로채기) 쓰지 않는다
    if (meta.issuer !== this.o.issuer) throw new Error(`discovery 의 issuer 가 다르다: ${meta.issuer}`);
    if (typeof meta.jwks_uri !== 'string') throw new Error('discovery 에 jwks_uri 가 없다');
    return meta.jwks_uri;
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  private saveSnapshot(s: Snapshot): void {
    if (!this.o.snapshotFile) return;
    try {
      mkdirSync(dirname(this.o.snapshotFile), { recursive: true });
      const tmp = `${this.o.snapshotFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(s));
      renameSync(tmp, this.o.snapshotFile);
    } catch {
      /* 스냅숏은 보조 수단이다 — 못 써도 검증은 계속한다 */
    }
  }

  private loadSnapshot(): void {
    if (!this.o.snapshotFile) return;
    try {
      const s = JSON.parse(readFileSync(this.o.snapshotFile, 'utf8')) as Snapshot;
      if (s.issuer !== this.o.issuer || typeof s.fetchedAt !== 'number') return;
      const keys = publicSigningKeys(s);
      if (keys.length === 0) return;
      this.keys = new Map(keys.map((k) => [k.kid, k]));
      this.fetchedAt = s.fetchedAt;
      this.jwksUri = s.jwksUri;
      this.source = 'snapshot';
    } catch {
      /* 스냅숏 없음 — 발급자가 살아날 때까지 검증할 수 없다 */
    }
  }
}
