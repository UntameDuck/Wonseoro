import {
  assertNotMockInProduction,
  envChoice,
  envInt,
  envList,
  envOrDev,
  parseKeyRing,
  requireIssuerUrl,
  secretOrDev,
} from '@wonseoro/server-kit';

/** central-api 설정. */
export const PORT = envInt('PORT', 3000, { min: 1, max: 65535 });

export const CORS_ORIGINS = envList(
  'CORS_ORIGINS',
  ['http://localhost:4000'],
  '지원자 웹의 오리진',
);

/**
 * "내 원서" 조회용 지원자 참조 키 목록. `k2=비밀,k1=옛비밀` — 첫 번째가 현재 키. (§A12)
 *
 * 대학이 보내는 참조와 같은 키여야 찾아진다. 키를 바꾸는 동안 옛 키도 목록에 두면
 * 옛 키로 만든 참조도 계속 찾아진다. **Vault 서비스에는 주지 않는다** — 둘을 함께 가지면
 * 지원자 참조가 다시 Vault 와 조인된다.
 */
export const SUBJECT_REF_KEYS = parseKeyRing(
  secretOrDev(
    'SUBJECT_REF_KEYS',
    'k1=dev-dashboard-subject-key',
    '"내 원서" 조회용 지원자 참조 키 목록',
  ) || 'k0=unset',
);

/**
 * 지원자 신원을 어디서 얻을지. (대학 admission-api 와 같은 규칙, R8)
 *   dev-headers — `x-subject-token` 헤더를 그대로 믿는다. 누구나 남의 토큰을 보낼 수 있다. **개발 전용**
 *   gateway     — 앞단 인증 게이트웨이가 검증해 넣어 준 `x-authenticated-subject` 만 믿는다
 *   oidc        — 지원자 렐름 액세스 토큰을 이 API 가 직접 검증하고, 토큰의 주체(sub)를 가명 토큰으로 쓴다.
 *                 대학 API 와 **같은 렐름·같은 sub** 라 대학이 보낸 "내 원서" 참조·공통원서 Snapshot 과 이어진다
 *                 (T-M5-02 단계 4, docs/12-authentication-plan.md)
 *
 * 전에는 중앙에 이 구분이 없어 운영 모드에서도 헤더 한 줄로 남의 "내 원서" 를 볼 수 있었다.
 * 공통원서(이름·학교·연락처)를 읽고 쓰는 API 가 생기면서 더는 둘 수 없다.
 */
export const AUTH_MODE = envChoice(
  'AUTH_MODE',
  ['dev-headers', 'gateway', 'oidc'] as const,
  'dev-headers',
  '지원자 신원을 어디서 얻을지',
);
if (AUTH_MODE === 'dev-headers') assertNotMockInProduction('지원자 인증', 'dev-headers');

/**
 * OIDC 검증 설정 (AUTH_MODE=oidc 일 때만). 중앙은 지원자 API 뿐이라 지원자 렐름 하나다.
 * 중앙은 지원자 요청의 Critical Path 가 아니지만, 발급자 장애 중에도 "내 원서" 가 열리도록 대학과 같은
 * 공개키 캐시·스냅숏 규칙을 쓴다(T-M3-06).
 */
export const OIDC =
  AUTH_MODE === 'oidc'
    ? {
        applicantIssuer: requireIssuerUrl('OIDC_APPLICANT_ISSUER', '지원자 토큰 발급자(렐름) 주소 — 대학 API 와 같아야 한다'),
        audience: envOrDev('OIDC_AUDIENCE', 'wonseoro-central-api', '토큰 aud 에 있어야 할 이 API 의 이름'),
        jwksSnapshotDir: process.env.OIDC_JWKS_SNAPSHOT_DIR || null,
        jwksMaxStaleMs: envInt('OIDC_JWKS_MAX_STALE_MS', 24 * 60 * 60_000, { min: 60_000, max: 7 * 24 * 60 * 60_000 }),
      }
    : null;

/**
 * 대학 심장박동이 이만큼(초) 끊기면 그 대학을 "확인 불가" 로 본다. (§04 sync.heartbeat, D-60)
 * 대학 Relay 는 기본 60초마다 보낸다 — 세 번 연속 놓치면 끊긴 것이다.
 */
export const HEARTBEAT_STALE_SECONDS = envInt('HEARTBEAT_STALE_SECONDS', 180, { min: 30, max: 86_400 });
