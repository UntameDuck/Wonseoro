import {
  assertNotMockInProduction,
  configureEgress,
  devOnlyFlag,
  envBool,
  envChoice,
  envInt,
  envList,
  envOrDev,
  fieldKeyRing,
  internalAuthConfig,
  requireEnv,
  requireIssuerUrl,
  secretOrDev,
} from '@wonseoro/server-kit';
import { parsePeakModeActivation, parsePeakModeEnd } from './common/scheduling/peak-mode';

/**
 * admission-api 설정 — 기동 시점에 전부 확정한다.
 *
 * 값을 쓰는 자리에서 `process.env` 를 읽지 않는다. 그렇게 하면 설정이 빠진 것을
 * 그 코드가 처음 실행될 때에야 알게 된다. 마감 직전에 결제 경로에서 처음 드러나는 식이다.
 */

/** 이 프로세스가 어느 대학의 Data Plane 인가. 서비스의 정체성이다. */
/**
 * 내부 경로 상호 TLS (T-M5-05, D-69) — 서류 워커가 부르는 `/internal/v1/documents/**` 를 같은 대학의 서류 워커 인증서로만 받고,
 * 중앙(공통원서 스냅숏·상태 확인)을 부를 때 이 워크로드의 인증서를 낸다. none 은 개발·단위 시험만 — 운영에서는 기동 거부
 */
export const INTERNAL = internalAuthConfig();

export const UNIVERSITY_ID = requireEnv(
  'UNIVERSITY_ID',
  '이 프로세스가 어느 대학의 접수를 처리하는지. 공통원서 Snapshot 조회와 접수번호에 쓰인다',
);

/**
 * 원서 항목 값 암호화의 키 암호화 키(KEK) 묶음 `FIELD_KEK_KEYS` (T-M5-06). 운영은 필수, 개발 KEK(dev)는 운영에서 기동 거부.
 * 기동 때 읽어 빠진 것을 첫 저장이 아니라 지금 안다
 */
export const FIELD_KEYS = fieldKeyRing();

export const PORT = envInt('PORT', 3001, { min: 1, max: 65535 });

export const CORS_ORIGINS = envList(
  'CORS_ORIGINS',
  ['http://localhost:4000'],
  '지원자 웹의 오리진. 운영에서 기본값을 쓰면 개발 도메인이 열린다',
);

/** 중앙 Profile Vault. 없으면 공통원서 재사용만 꺼진다 — 접수는 계속된다. (D-18) */
export const CENTRAL_SYNC_URL = process.env.CENTRAL_SYNC_URL ?? '';

/**
 * 가명처리 소금.
 *
 * 쓰는 자리(감사 기록·중앙 전달)에서 읽으면, 운영에서 빠진 것을 **첫 접수 때** 알게 된다.
 * 그때는 이미 늦다. 그래서 기동 시점에 확정한다.
 *
 * 고정값이면 가명처리가 아니다 — IPv4 전체를 해시해 대조하면 몇 초면 원본이 나온다.
 */
export const AUDIT_IP_SALT = secretOrDev(
  'AUDIT_IP_SALT',
  'dev-salt',
  '감사 로그 IP 가명처리 소금',
);
export const CENTRAL_ID_SALT = secretOrDev(
  'CENTRAL_ID_SALT',
  'dev-salt',
  '중앙 전달용 식별자 가명처리 소금',
);
/**
 * "내 원서" 통합 조회용 지원자 참조 키. (v1.1 §A12, T-M3-09)
 *
 * 중앙에 보내는 지원자 참조는 이 키로 만든 HMAC 이다. 키 없는 해시였을 때는 중앙 Vault 의
 * 토큰을 해시하기만 하면 요약과 조인됐다 (D-39). 모든 대학과 중앙 대시보드가 같은 키를
 * 쓴다 — 같은 사람이면 대학이 달라도 같은 참조가 나와야 한다. Vault 는 이 키를 갖지 않는다.
 * 키 보관은 M5 Vault(§06).
 */
export const CENTRAL_SUBJECT_KEY = secretOrDev(
  'CENTRAL_SUBJECT_KEY',
  'dev-dashboard-subject-key',
  '"내 원서" 조회용 지원자 참조 키. 없으면 중앙에서 지원자 참조가 Vault 와 조인된다',
);
export const CENTRAL_SUBJECT_KEY_ID = envOrDev(
  'CENTRAL_SUBJECT_KEY_ID',
  'k1',
  '지원자 참조 키 식별자. 키를 바꾸면 이 값도 바꾼다',
);

export const VAULT_TIMEOUT_MS = envInt('VAULT_TIMEOUT_MS', 2000, { min: 100, max: 30_000 });

/**
 * 외부 의존성 Circuit Breaker. (v1.1 §01 C8)
 *
 * 연속 몇 번 실패하면 끊고, 얼마 뒤에 탐침을 보낼지.
 * 너무 짧게 잡으면 죽은 의존성에 계속 탐침이 가고, 너무 길게 잡으면
 * 살아난 뒤에도 그만큼 통합 조회·결제 확인이 멈춰 있다.
 */
export const BREAKER = {
  failureThreshold: envInt('BREAKER_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
  openMs: envInt('BREAKER_OPEN_MS', 30_000, { min: 1000, max: 600_000 }),
} as const;

/**
 * Central Dependency Health Gate. (v1.1 §A1)
 *
 * 중앙을 얼마 간격으로 확인할지, 중앙 반영이 얼마나 밀리면 "지연" 으로 볼지.
 * 확인 결과는 메모리에 두고 화면 조회는 그것만 읽는다. 마감 피크에 지원자
 * 수천 명이 배너 상태를 물어도 DB 와 중앙에는 이 간격으로만 간다.
 */
export const CENTRAL_GATE = {
  autostart: envBool('CENTRAL_GATE_AUTOSTART', true),
  intervalMs: envInt('CENTRAL_GATE_INTERVAL_MS', 10_000, { min: 1000, max: 300_000 }),
  syncLagWarnSeconds: envInt('SYNC_LAG_WARN_SECONDS', 300, { min: 10, max: 86_400 }),
} as const;

/**
 * 서버 시각 측정. (v1.1 §01 A9)
 *
 * 이 노드 시계와 DB 시계의 차이를 intervalMs 마다 probesPerSample 번 재서 왕복이 가장 짧은
 * 표본을 쓴다. 마지막 성공 측정이 intervalMs × 3 보다 오래되면 STALE 로 본다.
 */
export const CLOCK = {
  autostart: envBool('CLOCK_AUTOSTART', true),
  intervalMs: envInt('CLOCK_SAMPLE_INTERVAL_MS', 10_000, { min: 1000, max: 300_000 }),
  probesPerSample: envInt('CLOCK_PROBES_PER_SAMPLE', 3, { min: 1, max: 10 }),
} as const;

/**
 * 인증 방식.
 *   dev-headers — x-applicant-id / x-admin-id 헤더를 그대로 신뢰한다. **개발 전용**
 *   gateway     — 앞단 인증 게이트웨이가 검증해 넣어준 신원을 쓴다
 *   oidc        — 이 API 가 `Authorization: Bearer` 액세스 토큰을 직접 검증한다(발급자 공개키 캐시).
 *                 지원자 렐름·담당자 렐름을 따로 둔다 (T-M5-02·10, docs/12-authentication-plan.md A3)
 *
 * 운영에서 dev-headers 면 기동하지 않는다. 헤더만 바꾸면 누구나 남의 원서를
 * 열람·수정할 수 있기 때문이다.
 */
export const AUTH_MODE = envChoice(
  'AUTH_MODE',
  ['dev-headers', 'gateway', 'oidc'] as const,
  'dev-headers',
  '지원자·운영자 신원을 어디서 얻을지',
);
if (AUTH_MODE === 'dev-headers') {
  // 명시적으로 설정했더라도 운영에서는 막는다.
  // 이 모드에서는 헤더 한 줄로 누구나 남의 원서를 열람·수정할 수 있다.
  assertNotMockInProduction('지원자 인증', 'dev-headers');
}

/**
 * OIDC 검증 설정 (AUTH_MODE=oidc 일 때만).
 *
 *   applicantIssuer / staffIssuer — 렐름 둘. 지원자 토큰으로 운영 API 를, 담당자 토큰으로 지원자 API 를 쓸 수 없다
 *   audience       — 토큰 aud 에 이 API 이름이 있어야 한다
 *   staffAcr       — 담당자 토큰의 인증 수준. 비밀번호+OTP 가 아니면 운영 API 를 열지 않는다(T-M5-10)
 *   stepUpMaxAgeSec — 민감 동작(승인·활성화·증적 열람 등)은 이 시간 안에 직접 인증했어야 한다
 *   jwksSnapshotDir — 발급자 공개키를 남길 폴더. 발급자 장애 중에 Pod 가 다시 떠도 검증이 이어진다(T-M3-06)
 *   jwksMaxStaleMs — 발급자에서 키를 못 받은 채 이 시간이 지나면 검증을 멈춘다(닫힌 실패)
 *   applicantOutageGraceMs — 발급자가 끊긴 동안 **지원자** 토큰이 만료돼도 이 시간까지 받는다(D-67). 단절 전에 끝난 토큰,
 *                     발급자가 살아 있을 때의 만료 토큰은 받지 않는다. 담당자 토큰에는 두지 않는다 — 운영 동작은 기다려도 된다.
 *                     기본 2시간 = 중앙 단절 인수기준(§01 A1). 0 이면 끈다
 */
export const OIDC =
  AUTH_MODE === 'oidc'
    ? {
        applicantIssuer: requireIssuerUrl('OIDC_APPLICANT_ISSUER', '지원자 토큰 발급자(렐름) 주소'),
        staffIssuer: requireIssuerUrl('OIDC_STAFF_ISSUER', '대학 담당자 토큰 발급자(렐름) 주소'),
        audience: envOrDev('OIDC_AUDIENCE', 'wonseoro-admission-api', '토큰 aud 에 있어야 할 이 API 의 이름'),
        staffAcr: envOrDev('OIDC_STAFF_ACR', 'mfa', '담당자 토큰에 요구할 인증 수준(acr) — 비밀번호+OTP'),
        stepUpMaxAgeSec: envInt('OIDC_STEP_UP_MAX_AGE_SEC', 300, { min: 30, max: 3600 }),
        jwksSnapshotDir: process.env.OIDC_JWKS_SNAPSHOT_DIR || null,
        jwksMaxStaleMs: envInt('OIDC_JWKS_MAX_STALE_MS', 24 * 60 * 60_000, { min: 60_000, max: 7 * 24 * 60 * 60_000 }),
        applicantOutageGraceMs: envInt('OIDC_APPLICANT_OUTAGE_GRACE_MS', 2 * 60 * 60_000, { min: 0, max: 12 * 60 * 60_000 }),
      }
    : null;

/**
 * 운영 화면(/admin/v1)의 공유 비밀 — dev-headers·gateway 모드의 임시 문.
 * oidc 모드에서는 쓰지 않는다(담당자 토큰의 역할·인증 수준으로 막는다). 그 외 모드에서 없으면 운영에서 기동하지 않는다.
 */
export const ADMIN_API_TOKEN =
  AUTH_MODE === 'oidc'
    ? ''
    : secretOrDev('ADMIN_API_TOKEN', '', '/admin/v1 접근 비밀. 이 뒤에 마감시각 변경과 지원자 PII 열람이 있다');

/** 결제 대행사. Mock 은 운영에서 선택될 수 없다. */
export const PAYMENT_PROVIDER = envChoice(
  'PAYMENT_PROVIDER',
  ['mock'] as const,
  'mock',
  '결제 대행사 어댑터. 실 PG Sandbox 연동은 T-M6-04',
);
if (PAYMENT_PROVIDER === 'mock') assertNotMockInProduction('결제', 'mock');

/**
 * PG 콜백 서명 비밀. (v1.1 §A4·§B4, D-40)
 * 콜백은 인터넷에서 들어온다. 서명이 맞지 않으면 누구나 "결제 완료" 를 보낼 수 있다 —
 * 다만 콜백 값으로 상태를 정하지는 않는다(PG 에 다시 묻는다). 서명은 쓸데없는 재조회를 막는다.
 */
export const PG_CALLBACK_SECRET = secretOrDev(
  'PG_CALLBACK_SECRET',
  'dev-pg-callback-secret',
  'PG 콜백 서명 검증 비밀. 없으면 아무나 결제 콜백을 보낼 수 있다',
);

/**
 * 결제 재확인 워커. (D-40)
 *
 * PENDING·UNKNOWN 결제를 PG 에 다시 묻는다. 지원자가 결제 직후 창을 닫아도
 * 결제 확인이 저절로 끝나야 한다. 간격은 결제마다 Backoff 로 늘어난다(30초 → 30분).
 * maxAgeHours 가 지나면 더 묻지 않고 대조(PAYMENT_STATE_UNKNOWN_STALE)에 넘긴다.
 */
export const PAYMENT_RECHECK = {
  autostart: envBool('PAYMENT_RECHECK_AUTOSTART', true),
  intervalMs: envInt('PAYMENT_RECHECK_INTERVAL_MS', 30_000, { min: 1000, max: 3_600_000 }),
  batchSize: envInt('PAYMENT_RECHECK_BATCH', 50, { min: 1, max: 1000 }),
  maxAgeHours: envInt('PAYMENT_RECHECK_MAX_AGE_HOURS', 48, { min: 1, max: 720 }),
} as const;

/**
 * 대조 자동 실행. (§B18 "D+1 자동 대조", D-40)
 * 사람이 눌러야만 도는 대조는 사고가 난 뒤에야 돈다. 매시간 최근 sinceHours 를 본다 —
 * 48시간 창이면 D+1 을 매시간 덮는다.
 */
export const RECON_SCHEDULE = {
  autostart: envBool('RECON_SCHEDULE_AUTOSTART', true),
  intervalMs: envInt('RECON_SCHEDULE_INTERVAL_MS', 3_600_000, { min: 60_000, max: 86_400_000 }),
  sinceHours: envInt('RECON_SCHEDULE_SINCE_HOURS', 48, { min: 1, max: 720 }),
} as const;

/**
 * 만료된 멱등 기록 정리. (D-11)
 * 기록은 24시간 뒤 만료된다. 지우지 않으면 마감 피크의 모든 변경 요청이 영원히 쌓인다.
 * Peak Mode 억제 구간에는 돌지 않는다 — 접수 핵심 경로가 아니다.
 */
export const IDEMPOTENCY_PURGE = {
  autostart: envBool('IDEMPOTENCY_PURGE_AUTOSTART', true),
  intervalMs: envInt('IDEMPOTENCY_PURGE_INTERVAL_MS', 900_000, { min: 60_000, max: 86_400_000 }),
} as const;

/**
 * Admission Peak Mode (§01 B1, T-M4-07).
 *
 * HPA 최소 replica 전환은 GitOps 예약 자동화가 담당한다(D-48, ADR-0006). 이 프로세스는 같은
 * 예약의 억제 시각부터 종료 시각까지 자동 대조처럼 접수 핵심 경로가 아닌 내부 작업을 멈춰 DB 여유를 보존한다.
 */
const PEAK_MODE_ACTIVATES_AT_MS = parsePeakModeActivation(process.env.PEAK_MODE_ACTIVATES_AT);
export const PEAK_MODE = {
  enabled: envBool('PEAK_MODE_ENABLED', false),
  scheduledActivationMs: PEAK_MODE_ACTIVATES_AT_MS,
  scheduledEndMs: parsePeakModeEnd(process.env.PEAK_MODE_ENDS_AT, PEAK_MODE_ACTIVATES_AT_MS),
  suspendNonCriticalJobs: envBool('PEAK_MODE_SUSPEND_NON_CRITICAL_JOBS', true),
} as const;

/**
 * 지원자 단위 Adaptive Throttling (§01 B6, T-M4-40, ADR-0007).
 * IP 가 아니라 인증된 지원자 기준이라 학교 NAT 뒤 정상 수험생을 묶어 막지 않는다.
 * observe 는 판정만 세고 막지 않는다 — 운영 첫 적용·한도 조정 때 먼저 켠다.
 */
export const THROTTLE_MODE = envChoice(
  'THROTTLE_MODE',
  ['enforce', 'observe', 'off'] as const,
  'enforce',
  '지원자 단위 요청 한도를 적용할지',
);

/** 활성 마감정책이 없을 때 환경변수로 대신하는 개발용 경로. */
export const ALLOW_ENV_DEADLINE_POLICY = devOnlyFlag(
  'ALLOW_ENV_DEADLINE_POLICY',
  '승인 기록 없는 마감 판정은 근거를 남기지 못한다',
);

/**
 * 마감 임박 구간에는 설정을 바꾸지 않는다. (v1.1 §A14 Freeze)
 *
 * 마지막 몇 시간에 지원자가 몰리고, 그때의 설정 변경은 검증할 시간이 없다.
 * 전형료·양식이 이 시점에 바뀌면 이미 작성 중인 원서가 무효가 된다.
 *
 * 마감 **연장**은 이 잠금과 무관하다. 연장은 `deadline_policy` 의 일이고
 * `config_version` 을 건드리지 않는다. (§B17)
 */
export const CONFIG_FREEZE_HOURS = envInt('CONFIG_FREEZE_HOURS', 24, { min: 0, max: 720 });

/**
 * 활성화 기록 서명 키 — Ed25519 개인키(PKCS#8 PEM). (v1.1 §B17 · §A1, T-M3-15)
 *
 * 마감·설정을 적용할 때마다 "누가 언제 왜 무엇을" 을 이 키로 서명해 남긴다.
 * 공개키는 `GET /api/v1/meta/signing-keys` 로 공개한다. 대학 밖에서도 검증할 수 있어야
 * 서명의 의미가 있다.
 *
 * 비우면 개발용 고정 키를 쓴다. **운영에서는 필수다** — 개발 키로 서명한 기록은
 * 누구나 같은 서명을 만들 수 있으므로 아무것도 증명하지 못한다.
 * 키 보관은 M5 Vault(§06)로 옮긴다.
 */
export const POLICY_SIGNING_KEY = secretOrDev(
  'POLICY_SIGNING_KEY',
  '',
  '마감 연장·설정 활성화 기록 서명 키. 없으면 누가 무엇을 적용했는지 증명할 수 없다',
);
/** 키 교체를 대비해 기록마다 어떤 키로 서명했는지 남긴다. */
export const POLICY_SIGNING_KEY_ID = envOrDev(
  'POLICY_SIGNING_KEY_ID',
  'dev-ed25519-1',
  '서명 키 식별자. 키를 바꾸면 이 값도 바꾼다',
);

export const S3 = {
  bucket: envOrDev('S3_BUCKET', 'univ-a-documents', '서류를 저장할 버킷'),
  region: envOrDev('S3_REGION', 'us-east-1', 'Object Storage 리전'),
  endpoint: envOrDev('S3_ENDPOINT', 'http://localhost:9000', 'Object Storage 엔드포인트'),
  autoCreateBucket: devOnlyFlag(
    'S3_AUTO_CREATE_BUCKET',
    '운영 버킷은 IaC 로 만든다. 애플리케이션에 생성 권한을 주면 최소권한에 어긋난다',
  ),
} as const;

/**
 * 출구 허용 목록 (T-M5-07) — 이 서비스가 부르는 곳만: 중앙, 로그인 서버 두 렐름, Object Storage. 더할 것은 EGRESS_ALLOWLIST.
 * 연결 순간 메타데이터·링크 로컬 주소(운영은 루프백도)는 어느 이름으로 풀려도 거절한다.
 */
export const EGRESS = configureEgress([CENTRAL_SYNC_URL, OIDC?.applicantIssuer, OIDC?.staffIssuer, S3.endpoint]);
