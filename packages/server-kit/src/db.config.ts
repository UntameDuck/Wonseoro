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
  /**
   * 쿼리 하나가 응답을 기다리는 상한(ms). 넘으면 그 연결을 버린다 (T-M4-39).
   * 노드가 죽으면 그 노드의 PgBouncer 로 이미 열린 연결은 응답도 오류도 없이 매달린다 — 상한이 없으면
   * 살아남은 API Pod 의 요청까지 끝없이 기다려 노드 하나의 장애가 전체 장애가 된다(kind 에서 확인).
   */
  queryTimeoutMs: number;
}

/**
 * Vault가 넣은 DATABASE_URL의 자격증명·DB명은 유지하고 접속 목적지만 Pooler로 바꾼다.
 * URL을 Helm에서 분해해 Secret 값을 ConfigMap에 흘리지 않기 위해 런타임에서 처리한다.
 */
export function databaseConnectionString(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.DATABASE_URL;
  const host = env.DB_PROXY_HOST;
  const port = env.DB_PROXY_PORT;
  const sslMode = env.DB_PROXY_SSLMODE;
  if (!host && !port) return raw;
  if (!raw) throw new Error('DB Proxy를 쓰려면 DATABASE_URL이 필요합니다');
  if (!host || !port) throw new Error('DB_PROXY_HOST와 DB_PROXY_PORT는 함께 설정해야 합니다');
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`DB_PROXY_PORT는 1~65535의 정수여야 합니다: ${port}`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL 형식이 올바르지 않습니다');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`DATABASE_URL은 PostgreSQL URL이어야 합니다: ${url.protocol}`);
  }
  url.hostname = host;
  url.port = String(n);
  if (sslMode) {
    if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)) {
      throw new Error(`DB_PROXY_SSLMODE가 올바르지 않습니다: ${sslMode}`);
    }
    url.searchParams.set('sslmode', sslMode);
  }
  return url.toString();
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
    queryTimeoutMs: 10_000,
  },
  'document-service': {
    max: 5,
    idleTimeoutMs: 10_000,
    acquireTimeoutMs: 3_000,
    startupJitterMs: 2_000,
    queryTimeoutMs: 10_000,
  },
  // 중앙은 조회가 많고 쓰기는 이벤트 수신뿐이다.
  'central-api': {
    max: 10,
    idleTimeoutMs: 10_000,
    acquireTimeoutMs: 3_000,
    startupJitterMs: 2_000,
    queryTimeoutMs: 10_000,
  },
  // Relay 는 배치 처리라 커넥션이 적어도 된다. 접수 API 의 몫을 뺏지 않는다.
  'event-relay': {
    max: 3,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
    startupJitterMs: 5_000,
    queryTimeoutMs: 15_000,
  },
};

export function poolBudgetFor(service: string): DbPoolBudget {
  const budget = DB_POOL_BUDGET[service];
  if (!budget) {
    throw new Error(`DB pool budget 이 정의되지 않은 서비스입니다: ${service}`);
  }
  // 배포가 Pod 당 상한을 정한다 (Helm `database.pool.maxPerPod`). 차트가 replica × 상한이
  // 전체 예산(connectionBudget)을 넘지 않는지 렌더링 때 막는다. (T-M4-09, §B2)
  const override = process.env.DB_POOL_MAX;
  if (override !== undefined && override !== '') {
    const max = Number(override);
    if (!Number.isInteger(max) || max < 1 || max > 500) {
      throw new Error(`DB_POOL_MAX 는 1~500 의 정수여야 합니다: ${override}`);
    }
    return { ...budget, max };
  }
  return budget;
}

/** 기동 시 무작위 지연. 여러 Pod 가 동시에 커넥션을 열지 않게 한다. */
export function startupJitter(service: string): number {
  return Math.floor(Math.random() * poolBudgetFor(service).startupJitterMs);
}
