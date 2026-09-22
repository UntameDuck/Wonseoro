/**
 * DB Connection Pool 예산 — 기술설계서 v1.1 §B2
 *
 * 마감 피크에 Pod 가 늘어나면 Pod 수 × pool 크기만큼 커넥션이 몰린다.
 * DB max_connections 를 넘기면 전체가 멈춘다. 그래서 두 가지를 고정한다.
 *   1. 서비스별 pool 상한
 *   2. 신규 Pod 의 connection jitter (동시 접속 폭주 방지)
 *
 * 운영에서는 PgBouncer 계열 Pooler 를 앞단에 둔다. (T-M4-09)
 */
export interface DbPoolBudget {
  /** 이 프로세스가 열 수 있는 최대 커넥션. */
  max: number;
  /** 유휴 커넥션 반환까지 대기 시간(ms). */
  idleTimeoutMs: number;
  /** 커넥션 획득 대기 상한(ms). 넘으면 빠르게 실패시킨다. */
  acquireTimeoutMs: number;
  /** 기동 시 커넥션 폭주를 막는 지연 상한(ms). */
  startupJitterMs: number;
}

/**
 * 서비스별 예산.
 * 합계가 DB max_connections 를 넘지 않도록 Pod replica 수와 함께 계산한다.
 *   총 커넥션 = Σ (서비스 replica × 해당 서비스 max)
 */
export const DB_POOL_BUDGET: Record<string, DbPoolBudget> = {
  'admission-api': {
    max: 10,
    idleTimeoutMs: 10_000,
    acquireTimeoutMs: 3_000,
    startupJitterMs: 2_000,
  },
  'document-service': {
    max: 5,
    idleTimeoutMs: 10_000,
    acquireTimeoutMs: 3_000,
    startupJitterMs: 2_000,
  },
  // 중앙은 조회가 많고 쓰기는 이벤트 수신뿐이다.
  'central-api': {
    max: 10,
    idleTimeoutMs: 10_000,
    acquireTimeoutMs: 3_000,
    startupJitterMs: 2_000,
  },
  // Relay 는 배치 처리라 커넥션이 적어도 된다. 접수 API 의 몫을 뺏지 않는다.
  'event-relay': {
    max: 3,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
    startupJitterMs: 5_000,
  },
};

export function poolBudgetFor(service: string): DbPoolBudget {
  const budget = DB_POOL_BUDGET[service];
  if (!budget) {
    throw new Error(`DB pool budget 이 정의되지 않은 서비스입니다: ${service}`);
  }
  return budget;
}

/** 기동 시 무작위 지연. 여러 Pod 가 동시에 커넥션을 열지 않게 한다. */
export function startupJitter(service: string): number {
  return Math.floor(Math.random() * poolBudgetFor(service).startupJitterMs);
}
