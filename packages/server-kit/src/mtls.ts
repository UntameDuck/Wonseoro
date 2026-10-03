import { readFileSync, statSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import { Logger } from '@nestjs/common';
import { Agent, fetch as undiciFetch } from 'undici';
import { assertNotMockInProduction, envChoice, requireEnv } from './env';

/**
 * 서비스 간 상호 TLS — T-M5-05, docs/13-security-controls-plan.md B1~B5
 *
 * 계약은 내부 경로(`/internal/**`)에 mutualTLS 를 요구한다. 서비스 메시 대신 앱이 직접 한다 — 대학 → 중앙은 클러스터를 건너고,
 * 메시는 거기까지 닿지 않는다.
 *
 *   서버  HTTPS 로 듣고 클라이언트 인증서를 **요청**한다(TLS 단계에서 강제하지 않는다 — 공개 경로는 인증서 없이 온다).
 *         `/internal/**` 만 플랫폼 CA 가 서명한 인증서를 요구하고, 인증서의 워크로드 신원으로 무엇을 할 수 있는지 정한다
 *   신원  인증서 SAN URI — `spiffe://wonseoro/university/<대학ID>/<워크로드>`, `spiffe://wonseoro/central/<워크로드>`
 *   교체  인증서는 짧게(24시간) 쓴다. 파일이 바뀌면 다시 읽는다 — 서버는 `setSecureContext`, 클라이언트는 연결 풀을 새로 만든다
 *
 * `INTERNAL_AUTH=none` 은 개발 서버·단위 시험용이다. 운영에서 고르면 기동을 막는다.
 */

export type InternalAuthMode = 'mtls' | 'none';

export interface MtlsFiles {
  certFile: string;
  keyFile: string;
  caFile: string;
}

export interface InternalAuthConfig {
  mode: InternalAuthMode;
  files: MtlsFiles | null;
}

let configured: InternalAuthConfig | null = null;

/** 환경에서 읽는다 — INTERNAL_AUTH, MTLS_CERT_FILE·MTLS_KEY_FILE·MTLS_CA_FILE. 프로세스에서 한 번(설정 파일과 공용 클라이언트가 같은 값을 쓴다) */
export function internalAuthConfig(): InternalAuthConfig {
  configured ??= readInternalAuthConfig();
  return configured;
}

function readInternalAuthConfig(): InternalAuthConfig {
  const mode = envChoice('INTERNAL_AUTH', ['mtls', 'none'] as const, 'none', '서비스 간 내부 경로 인증 — 운영은 mtls');
  if (mode === 'none') {
    assertNotMockInProduction('내부 경로 인증', 'INTERNAL_AUTH=none — 평문·무인증');
    return { mode, files: null };
  }
  return {
    mode,
    files: {
      certFile: requireEnv('MTLS_CERT_FILE', '이 워크로드의 인증서(PEM) — SAN URI 가 워크로드 신원'),
      keyFile: requireEnv('MTLS_KEY_FILE', '이 워크로드의 개인키(PEM)'),
      caFile: requireEnv('MTLS_CA_FILE', '플랫폼 CA 인증서(PEM) — 상대 인증서를 이것으로 검증한다'),
    },
  };
}

/* ── 신원 ──────────────────────────────────────────────────────────── */

export interface WorkloadIdentity {
  zone: 'university' | 'central';
  /** zone=university 일 때 대학 ID(UNIV-A) */
  universityId: string | null;
  workload: string;
  uri: string;
}

const UNIVERSITY_URI = /^spiffe:\/\/wonseoro\/university\/([A-Z0-9][A-Z0-9-]{1,31})\/([a-z0-9][a-z0-9-]{1,39})$/;
const CENTRAL_URI = /^spiffe:\/\/wonseoro\/central\/([a-z0-9][a-z0-9-]{1,39})$/;

export function parseWorkloadUri(uri: string): WorkloadIdentity | null {
  const u = UNIVERSITY_URI.exec(uri);
  if (u) return { zone: 'university', universityId: u[1] as string, workload: u[2] as string, uri };
  const c = CENTRAL_URI.exec(uri);
  if (c) return { zone: 'central', universityId: null, workload: c[1] as string, uri };
  return null;
}

export type PeerProblem = 'plaintext' | 'no-certificate' | 'untrusted' | 'no-identity' | 'ambiguous-identity';

export interface PeerCheck {
  identity: WorkloadIdentity | null;
  problem: PeerProblem | null;
}

/**
 * 연결의 상대 인증서에서 워크로드 신원을 꺼낸다. 플랫폼 CA 가 서명하지 않았거나(untrusted) 신원 URI 가 없거나
 * 여러 개면(ambiguous) 신원이 없다 — 이름이 둘인 인증서는 어느 쪽으로도 믿지 않는다.
 */
export function peerIdentity(socket: unknown): PeerCheck {
  const s = socket as Partial<TLSSocket> | undefined;
  if (!s || !s.encrypted || typeof s.getPeerCertificate !== 'function') return { identity: null, problem: 'plaintext' };
  const cert = s.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) return { identity: null, problem: 'no-certificate' };
  if (!s.authorized) return { identity: null, problem: 'untrusted' };
  const uris = (cert.subjectaltname ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.startsWith('URI:'))
    .map((x) => x.slice(4))
    .filter((x) => x.startsWith('spiffe://wonseoro/'));
  if (uris.length === 0) return { identity: null, problem: 'no-identity' };
  if (uris.length > 1) return { identity: null, problem: 'ambiguous-identity' };
  const identity = parseWorkloadUri(uris[0] as string);
  return identity ? { identity, problem: null } : { identity: null, problem: 'no-identity' };
}

/* ── 서버 ──────────────────────────────────────────────────────────── */

function readPem(files: MtlsFiles) {
  return { key: readFileSync(files.keyFile), cert: readFileSync(files.certFile), ca: readFileSync(files.caFile) };
}

/** HTTPS 서버 옵션 — 클라이언트 인증서를 요청하되 강제하지 않는다(내부 경로만 앱이 요구한다) */
export function serverTlsOptions(files: MtlsFiles) {
  return { ...readPem(files), requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.2' as const };
}

function mtimes(files: MtlsFiles): string {
  return [files.certFile, files.keyFile, files.caFile]
    .map((f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return 'missing';
      }
    })
    .join('|');
}

/**
 * 인증서 파일이 바뀌면 서버가 새 인증서를 쓰게 한다 — 짧은 인증서를 재기동 없이 교체한다(B5).
 * 바꾸다 실패하면(반쯤 쓴 파일 등) 쓰던 인증서를 그대로 두고 다음 확인 때 다시 한다.
 * @returns 멈추는 함수
 */
export function watchServerTls(server: { setSecureContext(o: object): void }, files: MtlsFiles, intervalMs = 30_000): () => void {
  const logger = new Logger('mtls');
  let seen = mtimes(files);
  const timer = setInterval(() => {
    const now = mtimes(files);
    if (now === seen) return;
    try {
      server.setSecureContext(readPem(files));
      seen = now;
      logger.log('서버 인증서를 새 파일로 바꿨다');
    } catch (err) {
      logger.warn(`서버 인증서를 바꾸지 못해 쓰던 것을 유지한다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/* ── 클라이언트 ────────────────────────────────────────────────────── */

/**
 * 내부 호출용 fetch — mtls 면 이 워크로드의 인증서를 내밀고, 상대 서버 인증서를 플랫폼 CA 로 검증한다.
 * none 이면 보통 fetch. 인증서 파일이 바뀌면 다음 호출부터 새 연결 풀을 쓴다.
 */
export class InternalHttpClient {
  private agent: Agent | null = null;
  private seen = '';
  private lastCheck = 0;

  constructor(private readonly files: MtlsFiles | null, private readonly recheckMs = 30_000) {}

  get mode(): InternalAuthMode {
    return this.files ? 'mtls' : 'none';
  }

  fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.files) return fetch(url, init);
    return undiciFetch(url, { ...(init as object), dispatcher: this.dispatcher() } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  }

  private dispatcher(): Agent {
    const files = this.files as MtlsFiles;
    const now = Date.now();
    if (this.agent && now - this.lastCheck < this.recheckMs) return this.agent;
    this.lastCheck = now;
    const m = mtimes(files);
    if (this.agent && m === this.seen) return this.agent;
    const old = this.agent;
    this.agent = new Agent({ connect: { ...readPem(files), minVersion: 'TLSv1.2' } });
    this.seen = m;
    if (old) void old.close().catch(() => {});
    return this.agent;
  }
}

let shared: InternalHttpClient | null = null;
/** 환경 설정으로 만든 공용 클라이언트(프로세스에 하나) */
export function internalHttp(): InternalHttpClient {
  shared ??= new InternalHttpClient(internalAuthConfig().files);
  return shared;
}
