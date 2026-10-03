import { X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { FieldKeyUnavailable, type KekProvider } from './field-crypto';
import { egressHttp, internalAuthConfig, type MtlsFiles } from './mtls';
import { fieldKeyRing } from './field-crypto';
import { watchCertificateExpiry } from './expiry';

/**
 * Vault — 대학별 경로 분리·짧은 자격증명 (T-M5-04, docs/13 단계 4, 노션 06 "Short-lived Credential", 첨부 `vault-policy.hcl`)
 *
 *   - **Transit** `transit/{encrypt,decrypt}/pii-<대학>` — 필드 암호화의 KEK(단계 3 의 `KekProvider`). KEK 는 Vault 밖으로 나오지 않는다
 *   - **DB 동적 자격증명** `database/creds/admission-api-<대학>` — 수명이 짧은 DB 계정. 수명 2/3 에 새 계정을 받아 연결 풀을 바꾼다(무중단)
 *   - **PKI** `pki/issue/kadmission-<대학>-service` — 상호 TLS 워크로드 인증서(단계 1). 24시간짜리를 수명 2/3 에 다시 받아 파일을 바꾼다
 *     (서버·클라이언트는 파일이 바뀌면 다시 읽는다 — 단계 1)
 *
 * 로그인은 Kubernetes(ServiceAccount 토큰) · AppRole · 토큰(개발). 대학 경계는 Vault 정책이 진다 — 한 대학의 신원으로 다른 대학 경로는 403.
 * 모든 호출은 출구 허용 목록을 거친다(VAULT_ADDR 를 각 서비스 configureEgress 에 넣는다).
 */

export class VaultError extends Error {
  constructor(readonly status: number, readonly vaultPath: string, detail: string) {
    super(`Vault ${vaultPath} → ${status}: ${detail}`);
    this.name = 'VaultError';
  }
}

export type VaultAuth =
  | { method: 'token'; token: string }
  | { method: 'approle'; roleId: string; secretId: string; mount?: string }
  | { method: 'kubernetes'; role: string; jwtFile?: string; mount?: string };

export interface VaultOptions {
  addr: string;
  auth: VaultAuth;
  namespace?: string;
  /** 시험용 — 기본은 출구 허용 목록을 거치는 egressHttp */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

const calls = metrics.getMeter('k-admission.vault').createCounter('vault_requests', {
  description: 'Vault 호출 수 (path_kind=transit|database|pki|auth|other, result=ok|denied|error)',
});

function pathKind(p: string): string {
  return /^(transit|database|pki|auth)\//.exec(p)?.[1] ?? 'other';
}

export class VaultClient {
  private token: string | null = null;
  private tokenUntil = 0;
  private readonly logger = new Logger('vault');

  constructor(private readonly o: VaultOptions) {}

  private async raw(method: string, p: string, body?: unknown, token?: string | null): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-vault-token'] = token;
    if (this.o.namespace) headers['x-vault-namespace'] = this.o.namespace;
    const f = this.o.fetch ?? ((u: string, i: RequestInit) => egressHttp().fetch(u, i));
    let res: Response;
    try {
      res = await f(`${this.o.addr.replace(/\/$/, '')}/v1/${p}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (err) {
      calls.add(1, { path_kind: pathKind(p), result: 'error' });
      throw new VaultError(0, p, (err as Error).message);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      calls.add(1, { path_kind: pathKind(p), result: res.status === 403 ? 'denied' : 'error' });
      throw new VaultError(res.status, p, JSON.stringify(json.errors ?? text).slice(0, 300));
    }
    calls.add(1, { path_kind: pathKind(p), result: 'ok' });
    return json;
  }

  /** 로그인 — 토큰 수명 2/3 이 지나면 다시 */
  private async login(): Promise<string> {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const a = this.o.auth;
    if (a.method === 'token') {
      this.token = a.token;
      this.tokenUntil = Number.MAX_SAFE_INTEGER;
      return this.token;
    }
    const res =
      a.method === 'approle'
        ? await this.raw('POST', `auth/${a.mount ?? 'approle'}/login`, { role_id: a.roleId, secret_id: a.secretId })
        : await this.raw('POST', `auth/${a.mount ?? 'kubernetes'}/login`, {
            role: a.role,
            jwt: readFileSync(a.jwtFile ?? '/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim(),
          });
    const auth = res.auth as { client_token: string; lease_duration: number };
    this.token = auth.client_token;
    this.tokenUntil = Date.now() + (auth.lease_duration > 0 ? (auth.lease_duration * 1000 * 2) / 3 : 3_600_000);
    return this.token;
  }

  async read(p: string): Promise<Record<string, unknown>> {
    return this.call('GET', p);
  }

  async write(p: string, body: unknown): Promise<Record<string, unknown>> {
    return this.call('POST', p, body);
  }

  private async call(method: string, p: string, body?: unknown): Promise<Record<string, unknown>> {
    const token = await this.login();
    try {
      return await this.raw(method, p, body, token);
    } catch (err) {
      // 토큰이 먼저 끝났다(취소·만료) — 한 번만 다시 로그인한다
      if (err instanceof VaultError && err.status === 403 && this.o.auth.method !== 'token' && /permission denied|invalid token/i.test(err.message)) {
        this.tokenUntil = 0;
        const again = await this.login();
        if (again !== token) return this.raw(method, p, body, again);
      }
      throw err;
    }
  }
}

/** 환경변수로 만든다 — VAULT_ADDR + (VAULT_K8S_ROLE | VAULT_ROLE_ID·VAULT_SECRET_ID | VAULT_TOKEN). 없으면 null */
export function vaultFromEnv(env: NodeJS.ProcessEnv = process.env): VaultClient | null {
  const addr = env.VAULT_ADDR;
  if (!addr) return null;
  const auth: VaultAuth | null = env.VAULT_K8S_ROLE
    ? { method: 'kubernetes', role: env.VAULT_K8S_ROLE, ...(env.VAULT_K8S_JWT_FILE ? { jwtFile: env.VAULT_K8S_JWT_FILE } : {}) }
    : env.VAULT_ROLE_ID && env.VAULT_SECRET_ID
      ? { method: 'approle', roleId: env.VAULT_ROLE_ID, secretId: env.VAULT_SECRET_ID }
      : env.VAULT_TOKEN
        ? { method: 'token', token: env.VAULT_TOKEN }
        : null;
  if (!auth) throw new Error('VAULT_ADDR 가 있으면 로그인 수단(VAULT_K8S_ROLE · VAULT_ROLE_ID+VAULT_SECRET_ID · VAULT_TOKEN)이 필요하다');
  return new VaultClient({ addr, auth, ...(env.VAULT_NAMESPACE ? { namespace: env.VAULT_NAMESPACE } : {}) });
}

/**
 * Transit KEK — `transit/encrypt/<키>` 로 DEK 를 감싼다. 연결 데이터(AAD)는 Transit 의 associated_data 로 넘긴다.
 * KEK ID 는 `<키>:v<버전>` — Vault 가 키를 돌리면(rotate) 새 DEK 는 새 버전으로 감싸이고, 옛 버전은 min_decryption_version 전까지 풀린다.
 * 정책은 encrypt·decrypt 만 준다(키 정보 읽기 없음) — 현재 버전은 감쌀 때 돌아온 암호문에서 안다.
 */
export class VaultTransitKeyRing implements KekProvider {
  private latest = 0;

  constructor(private readonly vault: VaultClient, readonly keyName: string) {}

  get activeId(): string {
    return `${this.keyName}:v${this.latest || 1}`;
  }

  /** 기동 때 한 번 — 지금 키 버전을 알고, 정책·연결이 맞는지 확인한다 */
  async init(): Promise<void> {
    await this.wrap(Buffer.alloc(32), 'probe');
  }

  async wrap(dek: Buffer, aad: string): Promise<{ kekId: string; wrapped: Buffer }> {
    let res: Record<string, unknown>;
    try {
      res = await this.vault.write(`transit/encrypt/${this.keyName}`, {
        plaintext: dek.toString('base64'),
        associated_data: Buffer.from(`dek|${aad}`).toString('base64'),
      });
    } catch (err) {
      throw new FieldKeyUnavailable('unwrap-failed', `Transit 감싸기 실패: ${(err as Error).message}`);
    }
    const ct = String((res.data as { ciphertext: string }).ciphertext);
    const v = Number(/^vault:v(\d+):/.exec(ct)?.[1] ?? 0);
    if (v > this.latest) this.latest = v;
    return { kekId: `${this.keyName}:v${v}`, wrapped: Buffer.from(ct, 'utf8') };
  }

  async unwrap(kekId: string, wrapped: Buffer, aad: string): Promise<Buffer> {
    if (!kekId.startsWith(`${this.keyName}:v`)) throw new FieldKeyUnavailable('unknown-kek', `${kekId} 는 Transit 키 ${this.keyName} 가 아니다`);
    try {
      const res = await this.vault.write(`transit/decrypt/${this.keyName}`, {
        ciphertext: wrapped.toString('utf8'),
        associated_data: Buffer.from(`dek|${aad}`).toString('base64'),
      });
      const dek = Buffer.from(String((res.data as { plaintext: string }).plaintext), 'base64');
      if (dek.length !== 32) throw new Error('DEK 길이');
      return dek;
    } catch (err) {
      if (err instanceof FieldKeyUnavailable) throw err;
      throw new FieldKeyUnavailable('unwrap-failed', `Transit 풀기 실패(${kekId}): ${(err as Error).message}`);
    }
  }
}

export interface DbCredential {
  username: string;
  password: string;
  leaseId: string;
  leaseSeconds: number;
}

/** DB 동적 자격증명 `database/creds/<역할>` — 부를 때마다 새 DB 계정 */
export async function vaultDbCredential(vault: VaultClient, role: string): Promise<DbCredential> {
  const res = await vault.read(`database/creds/${role}`);
  const data = res.data as { username: string; password: string };
  return { username: data.username, password: data.password, leaseId: String(res.lease_id), leaseSeconds: Number(res.lease_duration) };
}

export interface IssuedCert {
  serial: string;
  notAfter: Date;
  ttlSeconds: number;
}

/**
 * PKI 워크로드 인증서 — `pki/issue/<역할>` 로 SAN URI 인증서를 받아 tls.crt·tls.key·ca.crt 를 바꿔 쓴다(임시 파일 → rename, 반쯤 쓴 파일을 읽지 않게).
 * 서버(watchServerTls)·클라이언트(InternalHttpClient)는 파일이 바뀌면 다시 읽는다. 수명 2/3 에 다시 받는다.
 */
export class VaultCertRenewer {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger('vault-pki');

  constructor(
    private readonly vault: VaultClient,
    private readonly o: { role: string; uri: string; files: MtlsFiles; ttl?: string; commonName?: string; altNames?: string[]; ipSans?: string[] },
  ) {}

  async issue(): Promise<IssuedCert> {
    const res = await this.vault.write(`pki/issue/${this.o.role}`, {
      // 이름(CN)은 신원이 아니다 — 신원은 SAN URI. DNS 이름은 서버로서 호스트 이름 검증에 쓴다(서비스 이름)
      ...(this.o.commonName ? { common_name: this.o.commonName } : {}),
      uri_sans: this.o.uri,
      ...(this.o.altNames?.length ? { alt_names: this.o.altNames.join(',') } : {}),
      ...(this.o.ipSans?.length ? { ip_sans: this.o.ipSans.join(',') } : {}),
      ttl: this.o.ttl ?? '24h',
    });
    const d = res.data as { certificate: string; private_key: string; issuing_ca: string; ca_chain?: string[]; serial_number: string };
    const put = (file: string, body: string) => {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
      writeFileSync(tmp, body.endsWith('\n') ? body : `${body}\n`, { mode: 0o600 });
      renameSync(tmp, file);
    };
    // CA 먼저, 인증서를 마지막에 — 읽는 쪽은 인증서가 바뀐 것을 보고 셋을 다시 읽는다
    put(this.o.files.caFile, (d.ca_chain?.length ? d.ca_chain : [d.issuing_ca]).join('\n'));
    put(this.o.files.keyFile, d.private_key);
    put(this.o.files.certFile, d.certificate);
    const x = new X509Certificate(d.certificate);
    const notAfter = new Date(x.validTo);
    const ttlSeconds = Math.round((notAfter.getTime() - new Date(x.validFrom).getTime()) / 1000);
    this.logger.log(`워크로드 인증서 발급 — ${this.o.uri} 일련번호 ${d.serial_number} ~${notAfter.toISOString()}`);
    return { serial: d.serial_number, notAfter, ttlSeconds };
  }

  /** 지금 받고, 수명 2/3 마다 다시. 실패하면 1분 뒤 다시 — 지금 인증서가 끝나기 전까지 여유가 있다 */
  async start(): Promise<IssuedCert> {
    const first = await this.issue();
    const plan = (c: IssuedCert) => {
      const ms = Math.max(5_000, (c.notAfter.getTime() - Date.now()) * (2 / 3));
      this.timer = setTimeout(() => {
        this.issue().then(plan, (err: Error) => {
          this.logger.error(`인증서 다시 받기 실패 — 1분 뒤 다시: ${err.message}`);
          this.timer = setTimeout(() => void this.start().catch(() => undefined), 60_000);
          this.timer.unref();
        });
      }, ms);
      this.timer.unref();
    };
    plan(first);
    return first;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * 기동 때 Vault 에서 받을 것을 받는다 — 각 서비스 main 의 맨 앞에서 부른다(인증서 파일을 읽기 전에).
 *   MTLS_ISSUER=vault        → VAULT_PKI_ROLE·WORKLOAD_URI 로 인증서를 받아 MTLS_* 파일에 쓰고 수명 2/3 마다 다시
 *   FIELD_KEK_PROVIDER=vault → Transit 키에 한 번 감싸 보아 정책·연결을 확인한다(안 되면 기동 실패 — 첫 저장 때 알면 늦다)
 */
export async function startVaultSecrets(workload = 'service'): Promise<void> {
  const vault = vaultFromEnv();
  if (process.env.MTLS_ISSUER === 'vault') {
    const files = internalAuthConfig().files;
    const role = process.env.VAULT_PKI_ROLE;
    const uri = process.env.WORKLOAD_URI;
    if (!vault || !files || !role || !uri) throw new Error('MTLS_ISSUER=vault 이면 VAULT_ADDR·INTERNAL_AUTH=mtls·VAULT_PKI_ROLE·WORKLOAD_URI 가 필요하다');
    const altNames = (process.env.VAULT_PKI_ALT_NAMES ?? '').split(',').map((n) => n.trim()).filter(Boolean);
    await new VaultCertRenewer(vault, {
      role,
      uri,
      files,
      ...(altNames.length ? { altNames } : {}),
      ...(process.env.VAULT_PKI_TTL ? { ttl: process.env.VAULT_PKI_TTL } : {}),
    }).start();
  }
  // 인증서·CA 만료 지표(T-M5-65) — Vault 를 쓰든 Secret 을 쓰든
  watchCertificateExpiry(internalAuthConfig().files, workload);
  const ring = process.env.FIELD_KEK_PROVIDER === 'vault' ? fieldKeyRing() : null;
  if (ring instanceof VaultTransitKeyRing) await ring.init();
}
