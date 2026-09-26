import {
  assertNotMockInProduction,
  devOnlyFlag,
  envBool,
  envChoice,
  envInt,
  envList,
  envOrDev,
  requireEnv,
  secretOrDev,
} from '@wonseoro/server-kit';

/**
 * admission-api 설정 — 기동 시점에 전부 확정한다.
 *
 * 값을 쓰는 자리에서 `process.env` 를 읽지 않는다. 그렇게 하면 설정이 빠진 것을
 * 그 코드가 처음 실행될 때에야 알게 된다. 마감 직전에 결제 경로에서 처음 드러나는 식이다.
 */

/** 이 프로세스가 어느 대학의 Data Plane 인가. 서비스의 정체성이다. */
export const UNIVERSITY_ID = requireEnv(
  'UNIVERSITY_ID',
  '이 프로세스가 어느 대학의 접수를 처리하는지. 공통원서 Snapshot 조회와 접수번호에 쓰인다',
);

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
 * 인증 방식.
 *   dev-headers — x-applicant-id / x-admin-id 헤더를 그대로 신뢰한다. **개발 전용**
 *   gateway     — 앞단 인증 게이트웨이가 검증해 넣어준 신원을 쓴다 (T-M5-02)
 *
 * 운영에서 dev-headers 면 기동하지 않는다. 헤더만 바꾸면 누구나 남의 원서를
 * 열람·수정할 수 있기 때문이다.
 */
export const AUTH_MODE = envChoice(
  'AUTH_MODE',
  ['dev-headers', 'gateway'] as const,
  'dev-headers',
  '지원자·운영자 신원을 어디서 얻을지',
);
if (AUTH_MODE === 'dev-headers') {
  // 명시적으로 설정했더라도 운영에서는 막는다.
  // 이 모드에서는 헤더 한 줄로 누구나 남의 원서를 열람·수정할 수 있다.
  assertNotMockInProduction('지원자 인증', 'dev-headers');
}

/**
 * 운영 화면(/admin/v1)은 인증 게이트웨이 뒤에 둔다.
 * 그 전까지는 공유 비밀로 최소한의 문을 만든다. 없으면 운영에서 기동하지 않는다.
 */
export const ADMIN_API_TOKEN = secretOrDev(
  'ADMIN_API_TOKEN',
  '',
  '/admin/v1 접근 비밀. 이 뒤에 마감시각 변경과 지원자 PII 열람이 있다',
);

/** 결제 대행사. Mock 은 운영에서 선택될 수 없다. */
export const PAYMENT_PROVIDER = envChoice(
  'PAYMENT_PROVIDER',
  ['mock'] as const,
  'mock',
  '결제 대행사 어댑터. 실 PG 연동은 T-M5-06',
);
if (PAYMENT_PROVIDER === 'mock') assertNotMockInProduction('결제', 'mock');

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
