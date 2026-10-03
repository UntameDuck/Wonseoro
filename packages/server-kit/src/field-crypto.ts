import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { isProduction, secretOrDev } from './env';
import { VaultTransitKeyRing, vaultFromEnv } from './vault';

/**
 * 필드 암호화 — 봉투 암호화 (T-M5-06, docs/13 B7, v1.0 §8.3 "고위험 필드 별도 암호화, KEK/DEK 분리")
 *
 *   레코드(대학 원서 하나·공통원서 하나)마다 데이터 키(DEK, 32바이트 난수)를 만든다.
 *   값은 DEK 로 AES-256-GCM, DEK 는 키 암호화 키(KEK)로 다시 감싸(wrap) 레코드 옆에 둔다.
 *   KEK 는 DB 에 없다 — DB 를 통째로 가져가도 KEK 없이는 읽히지 않는다.
 *
 *   - **연결 데이터(AAD)** — DEK 는 `<범위>:<레코드 ID>`, 값은 `<레코드 ID>:<항목 코드>` 에 묶는다.
 *     암호문을 다른 레코드·다른 항목·다른 대학 DB 로 옮겨 붙이면 풀리지 않는다
 *   - **KEK 교체** — 새 KEK 를 맨 앞에 더하면 새 레코드는 새 KEK 로 감싼다. 옛 레코드는 옛 KEK 로 계속 풀린다.
 *     `rewrap` 이 감싼 DEK 만 새 KEK 로 바꾼다(값을 다시 암호화하지 않는다). 다 옮긴 뒤 옛 KEK 를 뺀다
 *   - **닫힌 실패** — KEK 가 없거나 풀리지 않으면 `FieldKeyUnavailable`. 빈 값·평문으로 대신하지 않는다
 *
 * KEK 는 처음엔 환경변수 키 묶음(`FIELD_KEK_KEYS`), 단계 4 에서 Vault Transit 이 같은 `KekProvider` 로 들어온다.
 */

export class FieldKeyUnavailable extends Error {
  constructor(readonly reason: 'unknown-kek' | 'unwrap-failed' | 'decrypt-failed', detail: string) {
    super(`필드 암호 키를 쓸 수 없다(${reason}): ${detail}`);
    this.name = 'FieldKeyUnavailable';
  }
}

const failures = metrics.getMeter('k-admission.field-crypto').createCounter('field_crypto_failures', {
  description: '필드 암호화 키를 쓰지 못한 횟수 (reason=unknown-kek|unwrap-failed|decrypt-failed)',
});

function fail(reason: FieldKeyUnavailable['reason'], detail: string): never {
  failures.add(1, { reason });
  throw new FieldKeyUnavailable(reason, detail);
}

/** KEK — DEK 를 감싸고 푸는 쪽. 키 자체는 밖으로 나오지 않는다(Vault Transit 과 같은 모양) */
export interface KekProvider {
  /** 새 DEK 를 감쌀 KEK 의 ID */
  readonly activeId: string;
  wrap(dek: Buffer, aad: string): Promise<{ kekId: string; wrapped: Buffer }>;
  unwrap(kekId: string, wrapped: Buffer, aad: string): Promise<Buffer>;
}

const IV = 12;
const TAG = 16;

function seal(key: Buffer, plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function open(key: Buffer, blob: Buffer, aad: string): Buffer | null {
  if (blob.length < IV + TAG) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(blob.subarray(IV, IV + TAG));
    return Buffer.concat([d.update(blob.subarray(IV + TAG)), d.final()]);
  } catch {
    return null;
  }
}

/** 개발 KEK — 저장소에 공개된 값이라 운영에서는 기동을 막는다 */
export const DEV_KEK_ID = 'dev';
const DEV_KEK = createHash('sha256').update('wonseoro-dev-field-kek').digest();

/**
 * 로컬 키 묶음 `id=base64(32바이트),id=…` — **첫 번째가 현재 KEK**. 나머지는 옛 레코드를 풀 때만 쓴다.
 */
export class LocalKeyRing implements KekProvider {
  readonly activeId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(keys: ReadonlyArray<{ id: string; key: Buffer }>) {
    if (keys.length === 0) throw new Error('KEK 가 하나도 없다');
    for (const k of keys) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(k.id)) throw new Error(`KEK ID 형식이 틀렸다: ${k.id}`);
      if (k.key.length !== 32) throw new Error(`KEK ${k.id} 는 32바이트여야 한다`);
    }
    this.keys = new Map(keys.map((k) => [k.id, k.key]));
    if (this.keys.size !== keys.length) throw new Error('KEK ID 가 겹친다');
    this.activeId = (keys[0] as { id: string }).id;
  }

  static parse(spec: string): LocalKeyRing {
    return new LocalKeyRing(
      spec
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf('=');
          if (i <= 0) throw new Error('FIELD_KEK_KEYS 형식은 id=base64키,id=base64키 이다');
          return { id: pair.slice(0, i).trim(), key: Buffer.from(pair.slice(i + 1).trim(), 'base64') };
        }),
    );
  }

  ids(): string[] {
    return [...this.keys.keys()];
  }

  async wrap(dek: Buffer, aad: string): Promise<{ kekId: string; wrapped: Buffer }> {
    return { kekId: this.activeId, wrapped: seal(this.keys.get(this.activeId) as Buffer, dek, `dek|${aad}`) };
  }

  async unwrap(kekId: string, wrapped: Buffer, aad: string): Promise<Buffer> {
    const kek = this.keys.get(kekId);
    if (!kek) fail('unknown-kek', `${kekId} 가 키 묶음에 없다`);
    const dek = open(kek, wrapped, `dek|${aad}`);
    if (!dek || dek.length !== 32) fail('unwrap-failed', `${kekId} 로 풀리지 않는다(${aad})`);
    return dek;
  }
}

let ring: KekProvider | null = null;

/**
 * 이 프로세스의 KEK — `FIELD_KEK_KEYS`. 개발은 저장소의 개발 KEK, **운영은 필수이고 개발 KEK 를 거절한다**.
 * 단계 4 에서 `FIELD_KEK_PROVIDER=vault` 가 Vault Transit 으로 바꾼다.
 */
export function fieldKeyRing(): KekProvider {
  if (ring) return ring;
  // 단계 4 — KEK 를 Vault Transit 에 둔다(대학별 키 `pii-<대학>`, 정책이 다른 대학 키를 막는다)
  if (process.env.FIELD_KEK_PROVIDER === 'vault') {
    const vault = vaultFromEnv();
    const key = process.env.VAULT_TRANSIT_KEY;
    if (!vault || !key) throw new Error('FIELD_KEK_PROVIDER=vault 이면 VAULT_ADDR·VAULT_TRANSIT_KEY 가 필요하다');
    ring = new VaultTransitKeyRing(vault, key);
    return ring;
  }
  const spec = secretOrDev('FIELD_KEK_KEYS', `${DEV_KEK_ID}=${DEV_KEK.toString('base64')}`, '필드 암호화 키 암호화 키(KEK) 묶음');
  // 운영에서 빠졌으면 secretOrDev 가 설정 문제로 남겨 기동을 막는다 — 그때까지 쓸 일 없는 임시 키
  const local = spec ? LocalKeyRing.parse(spec) : new LocalKeyRing([{ id: 'unset', key: randomBytes(32) }]);
  if (isProduction() && local.ids().includes(DEV_KEK_ID)) {
    throw new Error('운영에서 개발 KEK(dev)는 쓸 수 없다 — FIELD_KEK_KEYS 에서 빼라');
  }
  ring = local;
  return ring;
}

/** 시험·Vault 연결용 — 프로세스 KEK 를 바꾼다 */
export function useFieldKeyRing(provider: KekProvider | null): void {
  ring = provider;
}

/** 값(JSON)을 DEK 로 봉한다 — 형식 `0x01 | iv | tag | 암호문` */
export function sealJson(dek: Buffer, value: unknown, aad: string): Buffer {
  return Buffer.concat([Buffer.from([1]), seal(dek, Buffer.from(JSON.stringify(value ?? null), 'utf8'), aad)]);
}

export function openJson(dek: Buffer, blob: Buffer, aad: string): unknown {
  if (blob[0] !== 1) fail('decrypt-failed', `알 수 없는 형식 ${blob[0]}`);
  const plain = open(dek, blob.subarray(1), aad);
  if (!plain) fail('decrypt-failed', aad);
  return JSON.parse(plain.toString('utf8'));
}

/** `query` 만 있으면 된다 — pg Pool·PoolClient·server-kit Db */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface RecordKeyStoreOptions {
  /** DEK 표 — `<idColumn>` 기본키, `kek_version`, `wrapped_dek` */
  table: string;
  idColumn: string;
  /** DEK 의 연결 데이터 앞부분 — 대학까지 넣는다(다른 대학 DB 로 옮긴 키는 풀리지 않는다) */
  scope: string;
  /** 푼 DEK 를 메모리에 두는 시간. 기본 5분 */
  ttlMs?: number;
  maxEntries?: number;
}

/**
 * 레코드별 DEK 저장소 — 표 하나에 감싼 DEK 를 두고, 푼 DEK 는 잠깐 메모리에 둔다(Vault 를 부르는 횟수를 줄인다).
 */
export class RecordKeyStore {
  private readonly cache = new Map<string, { dek: Buffer; until: number }>();
  private readonly logger = new Logger('field-crypto');

  constructor(private readonly kek: () => KekProvider, private readonly o: RecordKeyStoreOptions) {}

  private aad(id: string): string {
    return `${this.o.scope}:${id}`;
  }

  private remember(id: string, dek: Buffer): Buffer {
    const max = this.o.maxEntries ?? 10_000;
    if (this.cache.size >= max) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(id, { dek, until: Date.now() + (this.o.ttlMs ?? 300_000) });
    return dek;
  }

  /** 레코드의 DEK. 없으면 `create` 일 때 만든다(동시에 만들어도 하나만 남는다), 아니면 null */
  async dek(db: Queryable, id: string, create: boolean): Promise<Buffer | null> {
    const hit = this.cache.get(id);
    if (hit && hit.until > Date.now()) return hit.dek;
    const read = async () =>
      (
        await db.query<{ kek_version: string; wrapped_dek: Buffer }>(
          `SELECT kek_version, wrapped_dek FROM ${this.o.table} WHERE ${this.o.idColumn} = $1`,
          [id],
        )
      ).rows[0];
    let row = await read();
    if (!row) {
      if (!create) return null;
      const fresh = randomBytes(32);
      const { kekId, wrapped } = await this.kek().wrap(fresh, this.aad(id));
      await db.query(
        `INSERT INTO ${this.o.table} (${this.o.idColumn}, kek_version, wrapped_dek) VALUES ($1,$2,$3)
         ON CONFLICT (${this.o.idColumn}) DO NOTHING`,
        [id, kekId, wrapped],
      );
      row = await read();
      if (!row) fail('unwrap-failed', `${id} 의 DEK 를 만들지 못했다`);
    }
    return this.remember(id, await this.kek().unwrap(row.kek_version, row.wrapped_dek, this.aad(id)));
  }

  /**
   * 현재 KEK 가 아닌 것으로 감싼 DEK 를 현재 KEK 로 다시 감싼다. `from` 을 주면 그 KEK 로 감싼 것만(그 KEK 를 뺄 때). 바꾼 개수
   */
  async rewrap(db: Queryable, o: { batch?: number; from?: string } = {}): Promise<number> {
    const k = this.kek();
    const { rows } = await db.query<{ id: string; kek_version: string; wrapped_dek: Buffer }>(
      `SELECT ${this.o.idColumn}::text AS id, kek_version, wrapped_dek FROM ${this.o.table}
        WHERE kek_version <> $1 AND ($3::text IS NULL OR kek_version = $3) ORDER BY ${this.o.idColumn} LIMIT $2`,
      [k.activeId, o.batch ?? 500, o.from ?? null],
    );
    for (const r of rows) {
      const dek = await k.unwrap(r.kek_version, r.wrapped_dek, this.aad(r.id));
      const { kekId, wrapped } = await k.wrap(dek, this.aad(r.id));
      await db.query(
        `UPDATE ${this.o.table} SET kek_version = $2, wrapped_dek = $3 WHERE ${this.o.idColumn} = $1 AND kek_version = $4`,
        [r.id, kekId, wrapped, r.kek_version],
      );
    }
    if (rows.length > 0) this.logger.log(`DEK ${rows.length}개를 ${k.activeId} 로 다시 감쌌다`);
    return rows.length;
  }

  forgetForTest(): void {
    this.cache.clear();
  }
}
