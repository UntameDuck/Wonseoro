/**
 * Dependency Circuit Breaker — 기술설계서 v1.1 §01 C8
 *
 * **반복해서 실패하는 의존성은 끊는다.**
 *
 * 타임아웃만으로는 부족하다. 중앙이 느려지면 요청마다 타임아웃까지 기다렸다가
 * 실패하고, 그 대기가 쌓이면 접수 API 의 커넥션과 이벤트 루프를 먹는다.
 * 중앙 장애가 접수 장애로 번지는 경로가 이것이다. 이미 죽은 것으로 판명된
 * 의존성에는 묻지 않고 바로 실패시켜, 대기 자체를 없앤다.
 *
 *   CLOSED    — 정상. 호출한다. 연속 실패가 threshold 에 닿으면 OPEN
 *   OPEN      — 호출하지 않고 즉시 CircuitOpenError. openMs 가 지나면 HALF_OPEN
 *   HALF_OPEN — 탐침 1건만 통과시킨다. 성공하면 CLOSED, 실패하면 다시 OPEN
 *
 * **반열림이 반드시 있어야 한다.** 한 번 열리고 닫히지 않으면 의존성이 살아나도
 * 영원히 끊긴 채로 남는다. 반대로 탐침을 여러 건 풀어주면, 막 살아난 의존성에
 * 밀린 요청이 한꺼번에 몰려 다시 쓰러뜨린다.
 *
 * 왜 실패율이 아니라 **연속 실패**인가
 *   실패율은 표본이 있어야 의미가 있다. 문자·메일·Vault 조회처럼 호출이 드문
 *   의존성에서는 창 안에 표본이 몇 건 없어 판정이 흔들린다. 연속 실패는 호출
 *   빈도와 무관하게 같은 뜻을 가진다 — "최근 N번 연달아 안 됐다".
 *
 * 무엇을 실패로 볼지는 호출하는 쪽이 정한다.
 *   - 연결 거부·타임아웃·5xx → 의존성의 실패
 *   - 4xx → **우리 요청의 문제**다. 의존성은 살아 있고 대답했다. 세지 않는다
 *
 * 상태는 프로세스 안에만 있다. Pod 마다 따로 판단한다. 공유 저장소에 두면
 * 그 저장소가 새 의존성이 되고, 그게 죽으면 판단 자체를 못 한다.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** 의존성 이름. 로그와 상태 조회에 쓴다. */
  readonly name: string;
  /** 연속 몇 번 실패하면 여는가. */
  readonly failureThreshold: number;
  /** 연 뒤 얼마 뒤에 탐침을 보내는가. */
  readonly openMs: number;
  /** 시험에서 시계를 고정하려고 둔다. */
  readonly now?: () => number;
  /** 상태가 바뀔 때. 관제 경보를 여기에 건다. */
  readonly onStateChange?: (change: CircuitStateChange) => void;
}

export interface CircuitStateChange {
  readonly name: string;
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly consecutiveFailures: number;
}

export interface CircuitSnapshot {
  readonly name: string;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly failureThreshold: number;
  /** 마지막으로 연 시각. 한 번도 안 열렸으면 null */
  readonly openedAt: string | null;
  /** OPEN 일 때 다음 탐침까지 남은 시간. */
  readonly retryAfterMs: number;
  /** 마지막 실패 원인. 관제에서 "무엇 때문에 열렸나"를 보려고. */
  readonly lastFailure: string | null;
}

/** 열려 있어서 호출하지 않았다. 의존성에 닿지 않았다는 뜻이다. */
export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';
  constructor(
    readonly dependency: string,
    readonly retryAfterMs: number,
  ) {
    super(`${dependency} circuit is open (retry after ${retryAfterMs}ms)`);
  }
}

/** 결과는 받았지만 의존성의 실패로 볼 응답. 예: HTTP 5xx */
export class DependencyFailure extends Error {
  override readonly name = 'DependencyFailure';
  constructor(
    readonly dependency: string,
    readonly reason: string,
  ) {
    super(`${dependency} failed: ${reason}`);
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;
  private readonly onStateChange: ((change: CircuitStateChange) => void) | undefined;

  private current: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAtMs: number | null = null;
  private probeInFlight = false;
  private lastFailureReason: string | null = null;

  constructor(options: CircuitBreakerOptions) {
    if (!Number.isInteger(options.failureThreshold) || options.failureThreshold < 1) {
      throw new Error(`${options.name}: failureThreshold 는 1 이상의 정수여야 합니다`);
    }
    if (!(options.openMs > 0)) {
      throw new Error(`${options.name}: openMs 는 0 보다 커야 합니다`);
    }
    this.name = options.name;
    this.failureThreshold = options.failureThreshold;
    this.openMs = options.openMs;
    this.now = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
  }

  /** 지금 상태. OPEN 의 대기가 끝났으면 HALF_OPEN 으로 보인다. */
  get state(): CircuitState {
    if (this.current === 'OPEN' && this.retryAfterMs() === 0) return 'HALF_OPEN';
    return this.current;
  }

  /**
   * 지금 호출해도 되는가. 호출하지 않고 묻기만 한다.
   *
   * 한 번에 여러 건을 집어 가는 워커(relay·scanner)가 **집기 전에** 쓴다.
   * 열려 있는데 행을 집으면, 보내지도 못할 행에 잠금만 걸린다.
   */
  allowsRequest(): boolean {
    const s = this.state;
    if (s === 'CLOSED') return true;
    if (s === 'HALF_OPEN') return !this.probeInFlight;
    return false;
  }

  /**
   * 의존성 호출을 감싼다.
   *
   * fn 이 던지면 실패로 센다. 던지지 않았지만 실패로 볼 결과는
   * `isFailure` 로 알려준다 (예: 5xx 응답). 결과는 그대로 돌려준다.
   * 열려 있으면 fn 을 부르지 않고 CircuitOpenError 를 던진다.
   */
  async run<T>(
    fn: () => Promise<T>,
    options: { isFailure?: (result: T) => string | false } = {},
  ): Promise<T> {
    const probe = this.admit();

    let result: T;
    try {
      result = await fn();
    } catch (err) {
      this.recordFailure(describeFailure(err), probe);
      throw err;
    }

    const failure = options.isFailure?.(result);
    if (failure) {
      this.recordFailure(failure, probe);
    } else {
      this.recordSuccess(probe);
    }
    return result;
  }

  snapshot(): CircuitSnapshot {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.failures,
      failureThreshold: this.failureThreshold,
      openedAt: this.openedAtMs === null ? null : new Date(this.openedAtMs).toISOString(),
      retryAfterMs: this.retryAfterMs(),
      lastFailure: this.lastFailureReason,
    };
  }

  /** 통과시킬지 정한다. 탐침이면 true. */
  private admit(): boolean {
    const s = this.state;
    if (s === 'CLOSED') return false;
    if (s === 'HALF_OPEN' && !this.probeInFlight) {
      // 탐침은 한 건만. 나머지는 탐침 결과가 나올 때까지 계속 막는다.
      this.transition('HALF_OPEN');
      this.probeInFlight = true;
      return true;
    }
    throw new CircuitOpenError(this.name, Math.max(this.retryAfterMs(), 0));
  }

  private recordSuccess(probe: boolean): void {
    if (probe) this.probeInFlight = false;
    this.failures = 0;
    if (this.current !== 'CLOSED') this.transition('CLOSED');
  }

  private recordFailure(reason: string, probe: boolean): void {
    this.lastFailureReason = reason;
    this.failures += 1;
    if (probe) {
      // 탐침이 실패했다. 아직 안 살아났다. 대기를 처음부터 다시 센다.
      this.probeInFlight = false;
      this.open();
      return;
    }
    if (this.current === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.openedAtMs = this.now();
    this.transition('OPEN');
  }

  private transition(to: CircuitState): void {
    const from = this.current;
    this.current = to;
    if (from !== to) {
      this.onStateChange?.({ name: this.name, from, to, consecutiveFailures: this.failures });
    }
  }

  private retryAfterMs(): number {
    if (this.current !== 'OPEN' || this.openedAtMs === null) return 0;
    return Math.max(this.openedAtMs + this.openMs - this.now(), 0);
  }
}

/**
 * fetch 실패는 전부 TypeError 로 올라온다. cause 를 꺼내야
 * "연결 거부"인지 "DNS 실패"인지 "타임아웃"인지 구분된다.
 */
export function describeFailure(err: unknown): string {
  if (err instanceof DependencyFailure) return err.reason;
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'TIMEOUT';
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    return err.name;
  }
  return 'UNKNOWN';
}

/** HTTP 응답 중 의존성의 실패로 볼 것. 5xx 만 센다. 4xx 는 우리 요청의 문제다. */
export function httpServerError(res: { status: number }): string | false {
  return res.status >= 500 ? `HTTP_${res.status}` : false;
}
