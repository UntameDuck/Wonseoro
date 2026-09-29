/**
 * Adaptive Throttling — 기술설계서 v1.1 §01 B6, v1.0 §8.4, STRIDE D-02 (T-M4-40)
 *
 * 한 고등학교 전체가 같은 공인 IP 로 나온다. IP 로 막으면 정상 수험생이 통째로 막힌다.
 * 그래서 **IP 는 키로 쓰지 않는다.** 키는 인증된 지원자(세션·계정)다. 원서 단위 신호는 위험점수로 들어간다.
 *
 *   1. 지원자 × 요청 종류마다 토큰 버킷 — 사람의 정상 속도(자동저장 몇 초에 한 번)보다 넉넉하다
 *   2. 위험점수(0~100) — 남의 원서 조회 실패(404/403), 짧은 시간에 여러 원서 훑기, 한도 초과가 올리고 시간이 내린다
 *   3. 점수가 오르면 충전 속도를 줄이고, 높으면 변경 요청을 멈춘다(RISK). 조회는 계속 된다
 *   4. **최종제출은 정상 세션에서 절대 막지 않는다** (§8.4). 위험이 높을 때만 넉넉한 별도 한도를 둔다 —
 *      Finalize 는 멱등이라 재시도가 중복 접수가 되지 않는다
 *
 * 상태는 Pod 메모리에 둔다. 접수 경로에 새 의존성(Redis)을 넣지 않기 위해서다 — Pod 가 N 개면 한 지원자의
 * 실효 한도는 최대 N 배가 된다. 한도는 그걸 알고 정했다 (ADR-0007). 판정은 순수 함수라 시계를 주입해 시험한다.
 */

export type RequestClass = 'read' | 'save' | 'create' | 'upload' | 'payment' | 'cancel' | 'finalize';

export interface BucketSpec {
  /** 한 번에 몰아 쓸 수 있는 요청 수 */
  capacity: number;
  /** 초당 다시 채워지는 요청 수 */
  refillPerSecond: number;
}

/**
 * 지원자 한 명 · Pod 하나 기준. 사람의 정상 사용 대비 여유:
 *   자동저장은 보통 3~5초에 한 번(0.2~0.33/s) → save 0.5/s·30 버스트
 *   원서 화면 열기는 요청 10여 개 → read 2/s·120 버스트
 *   원서 생성은 전형마다 한 번 → create 30초에 1개·10 버스트
 */
export const DEFAULT_LIMITS: Record<Exclude<RequestClass, 'finalize'>, BucketSpec> & { finalize: BucketSpec } = {
  read: { capacity: 120, refillPerSecond: 2 },
  save: { capacity: 30, refillPerSecond: 0.5 },
  create: { capacity: 10, refillPerSecond: 1 / 30 },
  upload: { capacity: 30, refillPerSecond: 0.5 },
  payment: { capacity: 20, refillPerSecond: 0.2 },
  cancel: { capacity: 5, refillPerSecond: 1 / 60 },
  // 위험이 높을 때만 쓴다. 평소 Finalize 는 한도가 없다
  finalize: { capacity: 5, refillPerSecond: 0.1 },
};

export const RISK = {
  /** 이 이상이면 충전 속도를 절반으로 */
  elevated: 30,
  /** 이 이상이면 변경 요청을 멈춘다 */
  high: 70,
  max: 100,
  /** 반감기 */
  halfLifeMs: 5 * 60_000,
  /** 남의 원서·없는 원서를 찾다 실패 (BOLA 탐색) */
  ownershipMiss: 10,
  /** 한도를 넘겨 거절됨 — 스스로 계속 올라가지 않게 작게 */
  throttled: 5,
  /** 이 개수를 넘는 원서를 짧은 시간에 건드림 — 한 지원자는 전형 수만큼(수시 최대 6)만 갖는다 */
  distinctApplicationsAllowed: 6,
  distinctApplicationsWindowMs: 10 * 60_000,
  manyApplications: 20,
} as const;

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: 'BURST' | 'RISK'; retryAfterSeconds: number };

interface Bucket { tokens: number; at: number }
interface SubjectState {
  buckets: Partial<Record<RequestClass, Bucket>>;
  risk: number;
  riskAt: number;
  applications: Map<string, number>;
  lastSeen: number;
}

export interface ThrottleOptions {
  limits?: typeof DEFAULT_LIMITS;
  /** 추적하는 지원자 수 상한 — 넘으면 가장 오래 안 본 지원자부터 잊는다 (메모리 상한) */
  maxSubjects?: number;
  now?: () => number;
}

export class AdaptiveThrottle {
  private readonly subjects = new Map<string, SubjectState>();
  private readonly limits: typeof DEFAULT_LIMITS;
  private readonly maxSubjects: number;
  private readonly now: () => number;

  constructor(options: ThrottleOptions = {}) {
    this.limits = options.limits ?? DEFAULT_LIMITS;
    this.maxSubjects = options.maxSubjects ?? 100_000;
    this.now = options.now ?? Date.now;
  }

  get trackedSubjects(): number {
    return this.subjects.size;
  }

  /** 요청을 받기 전에 묻는다. 허용되면 토큰을 하나 쓴다. */
  check(subject: string, cls: RequestClass, applicationId?: string): Decision {
    const now = this.now();
    const state = this.state(subject, now);
    if (applicationId) this.touchApplication(state, applicationId, now);
    const risk = this.currentRisk(state, now);

    if (cls === 'finalize' && risk < RISK.high) return { allowed: true };
    if (risk >= RISK.high && cls !== 'read' && cls !== 'finalize') {
      // 점수가 high 아래로 내려오는 데 걸리는 시간 — 그때 다시 시도하면 된다
      const wait = RISK.halfLifeMs * Math.log2(risk / (RISK.high - 1));
      return { allowed: false, reason: 'RISK', retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }

    const spec = this.limits[cls];
    const refill = spec.refillPerSecond * (risk >= RISK.elevated ? 0.5 : 1);
    const bucket = state.buckets[cls] ?? { tokens: spec.capacity, at: now };
    bucket.tokens = Math.min(spec.capacity, bucket.tokens + ((now - bucket.at) / 1000) * refill);
    bucket.at = now;
    state.buckets[cls] = bucket;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    this.raise(state, RISK.throttled, now);
    return { allowed: false, reason: 'BURST', retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refill)) };
  }

  /**
   * 소유권 검사 실패 — 남의 원서(또는 없는 원서)를 찾았다. 식별자를 바꿔 가며 훑는 탐색(BOLA)의 신호다.
   * "아직 접수증 없음" 같은 정상 404 는 세지 않는다 — 그래서 응답 코드가 아니라 소유권 검사에서 직접 부른다.
   */
  noteOwnershipMiss(subject: string): void {
    const now = this.now();
    this.raise(this.state(subject, now), RISK.ownershipMiss, now);
  }

  riskOf(subject: string): number {
    const state = this.subjects.get(subject);
    return state ? this.currentRisk(state, this.now()) : 0;
  }

  private state(subject: string, now: number): SubjectState {
    let state = this.subjects.get(subject);
    if (state) {
      // Map 순서를 최근 사용 순으로 유지한다 (가장 앞이 가장 오래 안 본 지원자)
      this.subjects.delete(subject);
    } else {
      state = { buckets: {}, risk: 0, riskAt: now, applications: new Map(), lastSeen: now };
      while (this.subjects.size >= this.maxSubjects) {
        const oldest = this.subjects.keys().next().value;
        if (oldest === undefined) break;
        this.subjects.delete(oldest);
      }
    }
    state.lastSeen = now;
    this.subjects.set(subject, state);
    return state;
  }

  private currentRisk(state: SubjectState, now: number): number {
    return state.risk * 0.5 ** ((now - state.riskAt) / RISK.halfLifeMs);
  }

  private raise(state: SubjectState, amount: number, now: number): void {
    state.risk = Math.min(RISK.max, this.currentRisk(state, now) + amount);
    state.riskAt = now;
  }

  private touchApplication(state: SubjectState, applicationId: string, now: number): void {
    const fresh = !state.applications.has(applicationId);
    state.applications.set(applicationId, now);
    for (const [id, seen] of state.applications) {
      if (now - seen > RISK.distinctApplicationsWindowMs) state.applications.delete(id);
    }
    if (fresh && state.applications.size > RISK.distinctApplicationsAllowed) {
      this.raise(state, RISK.manyApplications, now);
    }
  }
}

/**
 * 경로 템플릿 → 요청 종류. null 이면 이 계층이 보지 않는다:
 *   헬스·관리자(별도 인증·망)·내부 경로·PG 콜백(서명 검증)·익명 공개 조회(카탈로그·서버 시각 — Edge 캐시·WAF 몫)
 */
export function classifyRoute(method: string, route: string | undefined): RequestClass | null {
  if (!route || !route.startsWith('/api/v1/')) return null;
  if (route.startsWith('/api/v1/payments/callbacks') || route.startsWith('/api/v1/meta')) return null;
  if (/^\/api\/v1\/(admission-cycles|admission-types|departments)/.test(route)) return null;
  const m = method.toUpperCase();
  if (m === 'POST' && route === '/api/v1/applications') return 'create';
  if (m === 'PATCH') return 'save';
  if (m === 'POST' && route.endsWith('/finalize')) return 'finalize';
  if (m === 'POST' && route.endsWith('/cancel')) return 'cancel';
  if (m !== 'GET' && /payment/.test(route)) return 'payment';
  if (m !== 'GET' && /document/.test(route)) return 'upload';
  return 'read';
}
