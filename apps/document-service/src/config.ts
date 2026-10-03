import {
  assertNotMockInProduction,
  envBool,
  envChoice,
  envInt,
  envOrDev,
  internalAuthConfig,
  requireEnv,
} from '@wonseoro/server-kit';

/** document-service 설정. */
export const PORT = envInt('PORT', 3002, { min: 1, max: 65535 });

export const ADMISSION_API_URL = envOrDev(
  'ADMISSION_API_URL',
  'http://localhost:3001',
  '검사 결과를 보고할 대학 접수 API 주소',
);

/**
 * 검사 엔진.
 *   mock   — 파일을 읽지 않는 흉내. **개발 전용**
 *   clamav — clamd(ClamAV 데몬)에 INSTREAM 으로 흘려보낸다 (T-M5-08, D-58)
 *
 * 운영에서 mock 이 선택되면 기동하지 않는다. 검사했다는 기록만 남고
 * 실제로는 아무것도 검사하지 않은 상태가 가장 위험하다.
 */
export const SCANNER_ENGINE = envChoice(
  'SCANNER_ENGINE',
  ['mock', 'clamav'] as const,
  'mock',
  '서류 악성코드 검사 엔진 (mock | clamav)',
);
if (SCANNER_ENGINE === 'mock') assertNotMockInProduction('서류 검사', 'mock');

/**
 * clamd 주소. clamav 엔진일 때만 쓴다 — 그때는 필수다(없으면 기동하지 않는다).
 * 같은 Pod 의 사이드카면 127.0.0.1, 별도 서비스면 그 서비스 이름.
 */
export const CLAMD = {
  host: SCANNER_ENGINE === 'clamav' ? requireEnv('CLAMD_HOST', 'clamav 엔진이 파일을 보낼 clamd 주소') : '',
  port: envInt('CLAMD_PORT', 3310, { min: 1, max: 65535 }),
  timeoutMs: envInt('CLAMD_TIMEOUT_MS', 30_000, { min: 1000, max: 300_000 }),
} as const;

export const SCANNER = {
  autostart: envBool('SCANNER_AUTOSTART', true),
  intervalMs: envInt('SCANNER_INTERVAL_MS', 3000, { min: 100, max: 600_000 }),
  /** mock 엔진 — 검사에 걸리는 시간을 흉내 낸다. 화면의 "검사 중" 상태를 실제로 보이게 하려는 목적. */
  delayMs: envInt('SCANNER_DELAY_MS', 1500, { min: 0, max: 60_000 }),
  timeoutMs: envInt('SCANNER_TIMEOUT_MS', 5000, { min: 100, max: 60_000 }),
  /** mock 엔진의 버전 표기. clamav 는 clamd 에 직접 묻는다(엔진·서명 DB 버전). */
  version: process.env.SCANNER_VERSION ?? 'mock-dev',
} as const;

/**
 * 접수 API Circuit Breaker. (v1.1 §01 C8)
 * 열려 있는 동안은 검사 대상을 가져오지 않는다.
 */
export const BREAKER = {
  failureThreshold: envInt('BREAKER_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
  openMs: envInt('BREAKER_OPEN_MS', 30_000, { min: 1000, max: 600_000 }),
} as const;

/**
 * 내부 호출 상호 TLS (T-M5-05, D-69) — 대학 API 의 서류 검사 경로(/internal/v1/documents)에 이 대학 서류 워커 인증서를 낸다.
 * none 은 개발·단위 시험만 — 운영에서는 기동 거부
 */
export const INTERNAL = internalAuthConfig();
