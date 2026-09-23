import { envBool, envInt, envOrDev, requireEnv } from '@wonseoro/server-kit';

/**
 * event-relay 설정.
 *
 * `UNIVERSITY_ID` 는 CloudEvents 의 `source` 가 된다. 중앙은 `source` + `id` 로
 * 중복을 판정하므로 이 값이 틀리면 **중복 제거와 순서 보장이 함께 깨진다.**
 * 기본값을 두면 여러 대학이 같은 source 로 이벤트를 보내게 된다. 그래서 필수다.
 */
export const UNIVERSITY_ID = requireEnv(
  'UNIVERSITY_ID',
  'CloudEvents source 가 된다. 중앙의 중복 제거 키의 일부다',
);

export const PORT = envInt('PORT', 3003, { min: 1, max: 65535 });

export const CENTRAL_SYNC_URL = envOrDev(
  'CENTRAL_SYNC_URL',
  'http://localhost:3000',
  '중앙 Sync Gateway 주소. 닿지 않아도 접수는 계속되지만 통합 조회가 멈춘다',
);

export const RELAY = {
  autostart: envBool('RELAY_AUTOSTART', true),
  intervalMs: envInt('RELAY_INTERVAL_MS', 2000, { min: 100, max: 600_000 }),
  batchSize: envInt('RELAY_BATCH_SIZE', 100, { min: 1, max: 1000 }),
  timeoutMs: envInt('RELAY_TIMEOUT_MS', 5000, { min: 100, max: 60_000 }),
} as const;
