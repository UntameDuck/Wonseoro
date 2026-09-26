import { assertNotMockInProduction, envBool, envChoice, envInt, envOrDev } from '@wonseoro/server-kit';

/** document-service 설정. */
export const PORT = envInt('PORT', 3002, { min: 1, max: 65535 });

export const ADMISSION_API_URL = envOrDev(
  'ADMISSION_API_URL',
  'http://localhost:3001',
  '검사 결과를 보고할 대학 접수 API 주소',
);

/**
 * 검사 엔진.
 *   mock — 확장자·크기만 보는 흉내. **개발 전용**
 *   실제 안티바이러스 연동은 T-M5-08.
 *
 * 운영에서 mock 이 선택되면 기동하지 않는다. 검사했다는 기록만 남고
 * 실제로는 아무것도 검사하지 않은 상태가 가장 위험하다.
 */
export const SCANNER_ENGINE = envChoice(
  'SCANNER_ENGINE',
  ['mock'] as const,
  'mock',
  '서류 악성코드 검사 엔진. 실 엔진 연동은 T-M5-08',
);
if (SCANNER_ENGINE === 'mock') assertNotMockInProduction('서류 검사', 'mock');

export const SCANNER = {
  autostart: envBool('SCANNER_AUTOSTART', true),
  intervalMs: envInt('SCANNER_INTERVAL_MS', 3000, { min: 100, max: 600_000 }),
  /** 검사에 걸리는 시간을 흉내 낸다. 화면의 "검사 중" 상태를 실제로 보이게 하려는 목적. */
  delayMs: envInt('SCANNER_DELAY_MS', 1500, { min: 0, max: 60_000 }),
  timeoutMs: envInt('SCANNER_TIMEOUT_MS', 5000, { min: 100, max: 60_000 }),
  version: envOrDev('SCANNER_VERSION', 'dev-0', '검사 엔진 버전. 감사 기록에 남는다'),
} as const;

/**
 * 접수 API Circuit Breaker. (v1.1 §01 C8)
 * 열려 있는 동안은 검사 대상을 가져오지 않는다.
 */
export const BREAKER = {
  failureThreshold: envInt('BREAKER_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
  openMs: envInt('BREAKER_OPEN_MS', 30_000, { min: 1000, max: 600_000 }),
} as const;
