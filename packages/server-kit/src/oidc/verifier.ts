import { decodeJwt, decodeProtectedHeader, errors, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { JwksCache, type JwksCacheOptions, type JwksCacheStatus } from './jwks-cache';

/**
 * OIDC 액세스 토큰 검증 — T-M5-02 (docs/12-authentication-plan.md A3·A4)
 *
 * API 가 토큰을 직접 검증한다. 앞단 게이트웨이를 두지 않는 이유는, 발급자가 끊겨도 대학 쪽에서 검증이
 * 이어져야 해서다(JWKS 캐시). 여기서는 **누구인지**(서명·발급자·대상·만료)만 본다.
 * 무엇을 해도 되는지(역할·인증 수준·재인증 시각)는 호출하는 쪽 가드가 정한다 — 경로마다 다르다.
 *
 * 거절 기준
 *   - 서명 알고리즘은 공개키 방식만(RS·PS·ES·EdDSA). `none`·HS* 는 받지 않는다 — 공개키를 HMAC 비밀로 쓰는 위조를 막는다
 *   - `kid` 가 없거나 모르는 키면 거절(모르는 kid 는 키 교체일 수 있어 한 번 다시 받아 본다 — JwksCache)
 *   - iss 정확히 일치, aud 에 이 API 포함, exp·iat·sub 필수, 시계 오차 30초까지
 *
 * 발급자 단절 유예 (`outageGraceMs`, D-67)
 *   발급자가 끊기면 브라우저가 토큰을 갱신할 수 없어, 5분짜리 액세스 토큰이 끝나는 순간 작성 중이던 지원자가 쫓겨난다.
 *   "이미 접속한 사람은 계속"(§01 A1)이 키 캐시만으로는 5분밖에 안 간다. 그래서 만료된 토큰을 아래 조건이 **모두**
 *   맞을 때만 받는다 — 서명·발급자·대상은 그대로 검사한다.
 *   - 발급자에 지금 닿지 않는다(키를 다시 받아 본다, 쿨다운에 한 번). 닿으면 갱신하라고 401 — 평소에는 아무것도 바뀌지 않는다
 *   - 만료된 지 `outageGraceMs` 를 넘지 않았다
 *   - 발급자에 마지막으로 닿은 뒤에 만료됐다 — 단절 전에 이미 끝난 토큰(훔친 옛 토큰)은 발급자를 멈추게 해도 쓸 수 없다
 */

export const DEFAULT_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const;

export interface OidcVerifierOptions extends JwksCacheOptions {
  /** 이 API 의 대상 이름 — 토큰 aud 에 있어야 한다 */
  audience: string;
  algorithms?: readonly string[];
  clockToleranceSec?: number;
  /** 발급자 단절 중 만료 토큰을 받는 최대 시간. 0(기본)이면 받지 않는다 — D-67 */
  outageGraceMs?: number;
}

export interface VerifiedToken {
  subject: string;
  /** 발급자가 넣은 역할. `roles` 클레임, 없으면 Keycloak `realm_access.roles` */
  roles: string[];
  /** 인증 수준(acr). 담당자 렐름은 비밀번호+OTP 를 `mfa` 로 준다 */
  acr: string | null;
  /** 사람이 마지막으로 직접 인증한 시각(초). step-up 판단에 쓴다 */
  authTime: number | null;
  issuedAt: number;
  expiresAt: number;
  claims: JWTPayload;
  /** 만료됐지만 발급자 단절 유예로 받았다 — 로그·지표용 */
  outageGrace?: boolean;
}

export type OidcTokenProblem =
  | 'missing'
  | 'malformed'
  | 'unsupported-algorithm'
  | 'unknown-key'
  | 'invalid-signature'
  | 'expired'
  | 'not-yet-valid'
  | 'invalid-claims';

/** 토큰이 틀렸다 — 401. 이유는 로그·지표용이고 응답에 그대로 쓰지 않는다 */
export class OidcTokenError extends Error {
  constructor(readonly problem: OidcTokenProblem, detail?: string) {
    super(detail ? `${problem}: ${detail}` : problem);
    this.name = 'OidcTokenError';
  }
}

/** 키를 쓸 수 없어 판단할 수 없다(발급자도 스냅숏도 없음, 또는 키가 너무 오래됨) — 503 */
export class OidcUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'OidcUnavailableError';
  }
}

function rolesOf(c: JWTPayload): string[] {
  const direct = (c as { roles?: unknown }).roles;
  const realm = (c as { realm_access?: { roles?: unknown } }).realm_access?.roles;
  const list = Array.isArray(direct) ? direct : Array.isArray(realm) ? realm : [];
  return list.filter((r): r is string => typeof r === 'string');
}

export class OidcVerifier {
  readonly jwks: JwksCache;
  private readonly algorithms: string[];
  private readonly clockTolerance: number;
  private readonly now: () => number;
  private readonly imported = new Map<string, Promise<Parameters<typeof jwtVerify>[1]>>();

  constructor(private readonly o: OidcVerifierOptions) {
    this.jwks = new JwksCache(o);
    this.algorithms = [...(o.algorithms ?? DEFAULT_ALGORITHMS)];
    this.clockTolerance = o.clockToleranceSec ?? 30;
    this.now = o.now ?? Date.now;
  }

  status(): JwksCacheStatus {
    return this.jwks.status();
  }

  /** `Authorization: Bearer …` 값에서 토큰을 꺼낸다 */
  static bearer(header: string | undefined): string {
    if (!header) throw new OidcTokenError('missing');
    const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header.trim());
    if (!m) throw new OidcTokenError('malformed', 'Bearer 형식이 아니다');
    return m[1] as string;
  }

  async verify(token: string): Promise<VerifiedToken> {
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new OidcTokenError('malformed', '헤더를 읽을 수 없다');
    }
    const alg = header.alg;
    if (typeof alg !== 'string' || !this.algorithms.includes(alg)) throw new OidcTokenError('unsupported-algorithm', String(alg));
    if (typeof header.kid !== 'string' || header.kid.length === 0) throw new OidcTokenError('unknown-key', 'kid 없음');

    const jwk = await this.jwks.key(header.kid);
    if (!jwk) {
      const s = this.jwks.status();
      if (s.expired || s.keyCount === 0) throw new OidcUnavailableError(`발급자 키를 쓸 수 없다(${s.lastError ?? '키 없음'})`);
      throw new OidcTokenError('unknown-key', header.kid);
    }
    // 키에 알고리즘이 적혀 있으면 토큰 헤더와 같아야 한다 — 같은 키를 다른 방식으로 쓰게 두지 않는다
    if (jwk.alg && jwk.alg !== alg) throw new OidcTokenError('unsupported-algorithm', `${alg} ≠ key ${jwk.alg}`);

    const cacheKey = `${header.kid}:${alg}:${JSON.stringify(jwk)}`;
    let key = this.imported.get(cacheKey);
    if (!key) {
      key = importJWK(jwk as Parameters<typeof importJWK>[0], alg) as Promise<Parameters<typeof jwtVerify>[1]>;
      this.imported.set(cacheKey, key);
    }

    const check = async (at: number) =>
      (
        await jwtVerify(token, await key, {
          issuer: this.o.issuer,
          audience: this.o.audience,
          algorithms: this.algorithms,
          clockTolerance: this.clockTolerance,
          currentDate: new Date(at),
          requiredClaims: ['sub', 'exp', 'iat'],
        })
      ).payload;

    let payload: JWTPayload;
    let outageGrace = false;
    try {
      payload = await check(this.now());
    } catch (err) {
      const problem = this.translate(err);
      if (problem.problem !== 'expired' || !(await this.withinOutageGrace(token))) throw problem;
      // 만료 직전 시각으로 다시 검증한다 — 서명·발급자·대상·발급 시각은 그대로 본다
      try {
        payload = await check(((decodeJwt(token).exp as number) - 1) * 1000);
      } catch (again) {
        throw this.translate(again);
      }
      outageGrace = true;
    }

    return {
      ...(outageGrace ? { outageGrace } : {}),
      subject: payload.sub as string,
      roles: rolesOf(payload),
      acr: typeof payload.acr === 'string' ? payload.acr : null,
      authTime: typeof payload.auth_time === 'number' ? payload.auth_time : null,
      issuedAt: payload.iat as number,
      expiresAt: payload.exp as number,
      claims: payload,
    };
  }

  /** 만료 토큰을 단절 유예로 받아도 되는가 — 위 설명의 세 조건 */
  private async withinOutageGrace(token: string): Promise<boolean> {
    const grace = this.o.outageGraceMs ?? 0;
    if (grace <= 0) return false;
    const exp = decodeJwt(token).exp;
    if (typeof exp !== 'number') return false;
    const expMs = exp * 1000;
    const lastContact = this.jwks.status().fetchedAt;
    if (lastContact === null || expMs < lastContact) return false;
    if (this.now() - expMs > grace) return false;
    return !(await this.jwks.issuerReachable());
  }

  private translate(err: unknown): OidcTokenError {
    if (err instanceof errors.JWTExpired) return new OidcTokenError('expired');
    if (err instanceof errors.JWTClaimValidationFailed) {
      return new OidcTokenError(err.claim === 'nbf' || err.claim === 'iat' ? 'not-yet-valid' : 'invalid-claims', `${err.claim}: ${err.reason}`);
    }
    if (err instanceof errors.JWSSignatureVerificationFailed) return new OidcTokenError('invalid-signature');
    if (err instanceof errors.JOSEAlgNotAllowed) return new OidcTokenError('unsupported-algorithm');
    if (err instanceof errors.JWTInvalid || err instanceof errors.JWSInvalid) return new OidcTokenError('malformed', (err as Error).message);
    return new OidcTokenError('invalid-signature', err instanceof Error ? err.message : String(err));
  }
}
