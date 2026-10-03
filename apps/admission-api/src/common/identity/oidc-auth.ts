import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM } from '@wonseoro/contracts';
import { Db, egressHttp, OidcTokenError, OidcUnavailableError, OidcVerifier, type VerifiedToken } from '@wonseoro/server-kit';
import { OIDC } from '../../config';
import { ProblemException } from '../problem/problem.exception';
import { requestTraceId } from '../problem/problem.filter';

/**
 * OIDC 인증 — T-M5-02·10 단계 3 (docs/12-authentication-plan.md A3·A5·A6·A9)
 *
 * 요청마다 가장 먼저(요청 한도보다 앞에서) 토큰을 검증해 `request.identity` 에 붙인다.
 * 한도·소유권·역할 검사는 모두 이 신원을 본다 — 헤더를 다시 읽지 않는다.
 *
 * 경로의 주인
 *   /admin/v1/**  담당자 렐름 토큰. 역할·인증 수준·재인증은 AdminGuard 가 경로마다 본다
 *   /api/v1/**    지원자 렐름 토큰. 계약에서 `security: []` 인 경로(시각·운영 상태·공개키·PG 콜백)만 토큰 없이
 *   그 밖        건강 확인·내부(mTLS) — 여기서 보지 않는다
 * 계약과 이 분류가 어긋나면 `oidc-routes.test.ts` 가 깨진다.
 */

export interface StaffIdentity {
  kind: 'staff';
  /** 감사·2인 승인에 남는 담당자 이름 — 발급자의 사용자 이름(바뀌지 않게 운영), 없으면 sub */
  adminId: string;
  subject: string;
  roles: string[];
  acr: string | null;
  /** 직접 인증한 시각(초) */
  authTime: number | null;
}

export interface ApplicantOidcIdentity {
  kind: 'applicant';
  applicantId: string;
  /** 지원자 렐름의 가명 주체(sub). 중앙 동기화의 지원자 토큰으로 쓴다 */
  subjectToken: string;
  /** 직접 인증한 시각(초) — 위험 차단을 본인확인 다시 하기로 풀 때 본다(ADR-0009) */
  authTime: number | null;
}

export type OidcIdentity = StaffIdentity | ApplicantOidcIdentity;

declare module 'fastify' {
  interface FastifyRequest {
    identity?: OidcIdentity;
  }
}

export type RouteAudience = 'public' | 'applicant' | 'staff' | 'none';

/** 계약에서 `security: []` 인 지원자 쪽 경로. 토큰 없이 부른다 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/v1/meta/time',
  'GET /api/v1/meta/operating-mode',
  'GET /api/v1/meta/signing-keys',
  // 모집·전형·모집단위 — 누구에게나 같은 공개 정보, 로그인 전 화면·운영 콘솔이 보인다 (계약 1.7.0, D-65)
  'GET /api/v1/admission-cycles/current',
  'GET /api/v1/admission-types',
  'GET /api/v1/departments',
  // PG 가 부른다 — 신원 대신 서명으로 막는다 (D-40)
  'POST /api/v1/payments/callbacks/:provider',
]);

/** 경로 모양(`/api/v1/applications/:applicationId`)으로 누구의 토큰이 필요한지 */
export function routeAudience(method: string, routeUrl: string | undefined): RouteAudience {
  if (!routeUrl || method === 'OPTIONS') return 'none';
  if (routeUrl.startsWith('/admin/v1/')) return 'staff';
  if (routeUrl.startsWith('/api/v1/')) return PUBLIC_ROUTES.has(`${method} ${routeUrl}`) ? 'public' : 'applicant';
  return 'none';
}

/* ── 지원자 등록 ───────────────────────────────────────────────────── */

/**
 * 지원자 렐름의 주체(sub) → 원서로 지원자 식별자. 처음 오면 만든다 (A9).
 * 실명·주민번호 같은 개인정보는 여기서 받지 않는다 — `pii_ciphertext` 는 비워 두고(`pii_key_version='none'`)
 * 본인확인 기관 연동·필드 암호화(T-M5-06) 때 채운다 (docs/10 G-7).
 */
@Injectable()
export class ApplicantDirectory {
  private readonly cache = new Map<string, string>();

  constructor(private readonly db: Db) {}

  async resolve(subject: string): Promise<string> {
    const hit = this.cache.get(subject);
    if (hit) return hit;
    // 같은 주체가 동시에 처음 와도 한 행만 생긴다(subject_token UNIQUE)
    await this.db.query(
      `INSERT INTO applicant (id, subject_token, pii_ciphertext, pii_key_version)
       VALUES ($1, $2, '\\x'::bytea, 'none')
       ON CONFLICT (subject_token) DO NOTHING`,
      [randomUUID(), subject],
    );
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM applicant WHERE subject_token = $1`, [subject]);
    const id = rows[0]?.id;
    if (!id) throw new Error('지원자 등록 직후 행을 찾지 못했다');
    if (this.cache.size >= 50_000) this.cache.clear();
    this.cache.set(subject, id);
    return id;
  }
}

/* ── 검증 ──────────────────────────────────────────────────────────── */

const meter = metrics.getMeter('k-admission.auth');
const decisions = meter.createCounter('auth_decisions', {
  description: '토큰 검증 판정 수 (audience=applicant|staff, result=ok|grace|missing|invalid|unavailable). grace = 발급자 단절 중 만료 토큰을 유예로 받음(D-67)',
});
const jwksAge = meter.createObservableGauge('oidc_jwks_age_seconds', {
  description: '발급자 공개키를 마지막으로 받은 뒤 지난 시간(realm=applicant|staff). 커지면 발급자와 끊긴 것이다(T-M3-06)',
});

@Injectable()
export class OidcAuthenticator {
  private readonly logger = new Logger('auth');
  readonly applicant: OidcVerifier;
  readonly staff: OidcVerifier;
  private lastGraceLog = 0;

  constructor(private readonly applicants: ApplicantDirectory) {
    if (!OIDC) throw new Error('AUTH_MODE=oidc 가 아닌데 OIDC 인증기를 만들었다');
    const snapshot = (name: string) => (OIDC!.jwksSnapshotDir ? join(OIDC!.jwksSnapshotDir, `jwks-${name}.json`) : undefined);
    // 공개키 조회도 출구 허용 목록을 거친다(T-M5-07) — 발급자 이름이 막힌 주소로 풀리면 받지 않는다
    const fetch = ((url: string | URL, init?: RequestInit) => egressHttp().fetch(String(url), init)) as typeof globalThis.fetch;
    const common = { audience: OIDC.audience, maxStaleMs: OIDC.jwksMaxStaleMs, fetch };
    this.applicant = new OidcVerifier({
      ...common,
      issuer: OIDC.applicantIssuer,
      snapshotFile: snapshot('applicant'),
      outageGraceMs: OIDC.applicantOutageGraceMs,
    });
    this.staff = new OidcVerifier({ ...common, issuer: OIDC.staffIssuer, snapshotFile: snapshot('staff') });
    jwksAge.addCallback((r) => {
      for (const [realm, v] of [['applicant', this.applicant], ['staff', this.staff]] as const) {
        const age = v.status().ageMs;
        if (age !== null) r.observe(age / 1000, { realm });
      }
    });
  }

  /** 경로에 맞는 토큰을 검증해 신원을 돌려준다. 토큰이 필요 없는 경로면 null */
  async authenticate(request: FastifyRequest): Promise<OidcIdentity | null> {
    const audience = routeAudience(request.method, request.routeOptions?.url);
    if (audience !== 'applicant' && audience !== 'staff') return null;
    try {
      const token = OidcVerifier.bearer(request.headers.authorization);
      const verified = await (audience === 'staff' ? this.staff : this.applicant).verify(token);
      const identity = audience === 'staff' ? staffOf(verified) : await this.applicantOf(verified);
      decisions.add(1, { audience, result: verified.outageGrace ? 'grace' : 'ok' });
      if (verified.outageGrace && Date.now() - this.lastGraceLog > 60_000) {
        // 단절 중에는 요청마다 온다 — 1분에 한 줄만
        this.lastGraceLog = Date.now();
        this.logger.warn(`발급자에 닿지 않아 만료된 ${audience} 토큰을 단절 유예로 받는 중 (D-67)`);
      }
      return identity;
    } catch (err) {
      if (err instanceof OidcUnavailableError) {
        decisions.add(1, { audience, result: 'unavailable' });
        this.logger.error(`발급자 키를 쓸 수 없어 ${audience} 토큰을 판단하지 못함: ${err.message}`);
        throw ProblemException.authUnavailable();
      }
      if (err instanceof OidcTokenError) {
        decisions.add(1, { audience, result: err.problem === 'missing' ? 'missing' : 'invalid' });
        // 토큰 값·주체는 남기지 않는다. 이유만 — trace_id 로 이어서 본다
        if (err.problem !== 'missing') this.logger.warn(`${audience} 토큰 거절: ${err.problem}`);
        throw ProblemException.unauthenticated();
      }
      throw err;
    }
  }

  private async applicantOf(v: VerifiedToken): Promise<ApplicantOidcIdentity> {
    return { kind: 'applicant', applicantId: await this.applicants.resolve(v.subject), subjectToken: v.subject, authTime: v.authTime };
  }
}

function staffOf(v: VerifiedToken): StaffIdentity {
  const username = v.claims.preferred_username;
  return {
    kind: 'staff',
    adminId: typeof username === 'string' && username.length > 0 ? username : v.subject,
    subject: v.subject,
    roles: v.roles,
    acr: v.acr,
    authTime: v.authTime,
  };
}

/**
 * Fastify 에 건다 — 요청 한도(throttle) 훅보다 **먼저** 걸어야 한다. 한도는 인증된 지원자 기준이다.
 * Nest 예외 필터 밖이라 오류 응답을 여기서 problem+json 으로 직접 쓴다.
 */
export function installOidcAuthentication(fastify: FastifyInstance, authenticator: OidcAuthenticator): void {
  fastify.decorateRequest('identity', undefined);
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      const identity = await authenticator.authenticate(request);
      if (identity) request.identity = identity;
    } catch (err) {
      if (!(err instanceof ProblemException)) throw err;
      for (const [name, value] of Object.entries(err.headers)) reply.header(name, value);
      return reply
        .status(err.problem.status)
        .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
        .header('cache-control', CACHE_CONTROL_PII)
        .send({ ...err.problem, instance: request.url, traceId: requestTraceId(request) });
    }
  });
}
