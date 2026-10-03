import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
/**
 * 서버 시각 — 기술설계서 v1.1 §01 A2 · A9 (D-31 · D-61)
 *
 * **시각의 권위는 DB 하나다.** (§A2) 접수·마감 판정 시각은 DB 시각으로 기록·비교한다.
 * Pod 가 여럿이면 각자 다른 시계를 갖고, 마감 직전에는 그 밀리초가 사람의 접수다.
 *
 * 그렇다고 요청마다 DB 에 시각을 물을 수는 없다. 그래서
 *   - 이 노드 시계와 DB 시계의 차이(offset)를 **계속 잰다** (§A9 "clock offset 지속 측정")
 *   - 화면 표시·요청 수신 시각처럼 DB 밖에서 쓰는 시각은 `now()` — 노드 시계를 offset 만큼 보정한 값
 *   - 접수 커밋 시각은 트랜잭션 안에서 DB 에 직접 묻는다 (finalization)
 *   - offset 이 허용오차를 넘은 노드는 Finalize 를 받지 않는다 (§A9 "허용오차 초과 Node 는
 *     Finalization Endpoint 에서 제거") — 503 재시도 안내, Edge 가 다른 Pod 로 보낸다 (D-52)
 *   - 접수 기록·감사에 offset 과 측정 상태를 남긴다 (§A9 "감사로그에 clock offset 과 time-source 상태")
 *
 * 독립된 두 시각원(노드의 NTP 동기 시계 · DB 서버 시계)을 서로 대조하는 것이다 (§A9 "복수 독립 Time Source").
 * 둘이 1초 넘게 어긋나면 어느 한쪽이 틀렸다 — 어느 쪽인지 모르므로 이 노드는 접수를 확정하지 않는다.
 *
 * 측정은 NTP 와 같은 방식이다: 왕복 시간의 절반을 불확실성으로 두고, 한 번에 여러 번 재서
 * 왕복이 가장 짧은 표본을 쓴다. 부하로 DB 응답이 늦을 때 offset 을 잘못 크게 재지 않기 위해서다.
 */
/** 허용 clock offset. 이를 넘으면 이 노드는 Finalize 를 수행하지 않는다. (v1.1 §A9) */
export declare const MAX_CLOCK_OFFSET_MS = 1000;
export type ClockStatus = 
/** 최근 측정이 허용오차 안이다. */
'SYNCED'
/** 노드 시계와 DB 시계가 허용오차를 넘게 어긋났다. 이 노드는 Finalize 를 받지 않는다. */
 | 'OFFSET_EXCEEDED'
/** 아직 한 번도 재지 못했다. 기동 직후이거나 DB 에 닿지 않는다. */
 | 'UNMEASURED'
/** 마지막 성공 측정이 오래됐다. 값은 남아 있지만 지금도 맞는지 모른다. */
 | 'STALE';
export interface ClockReading {
    status: ClockStatus;
    /** 이 노드 시계 − DB 시계 (ms). 양수면 노드가 앞선다. */
    offsetMs: number;
    /** 측정 불확실성 = 최소 왕복시간 / 2 (ms). 아직 못 쟀으면 null. */
    uncertaintyMs: number | null;
    /** 마지막 성공 측정 시각(DB 기준). */
    sampledAt: string | null;
    /** 대조한 시각원. */
    source: 'db';
}
export interface ClockSample {
    offsetMs: number;
    uncertaintyMs: number;
    /** 측정 시점의 DB 시각(ms). */
    dbTimeMs: number;
}
/**
 * 프로세스 안의 시각 상태. 서비스들이 생성자 주입 없이 쓴다 — 감사 기록·마감 판정·접수가
 * 모두 같은 값을 봐야 하고, 시험이 서비스를 직접 만들 때도 같은 규칙이 적용돼야 한다.
 * 측정은 `ClockMonitor` 가 채운다. 측정이 없으면 offset 0 (노드 시계 그대로)이다.
 */
export declare class ServerClock {
    private readonly maxOffsetMs;
    private readonly staleAfterMs;
    private offset;
    private uncertainty;
    private sampledAtMs;
    private lastSampleLocalMs;
    constructor(maxOffsetMs?: number, staleAfterMs?: number);
    /** DB 시계에 맞춘 지금. */
    now(): Date;
    record(sample: ClockSample, localNowMs?: number): void;
    reading(localNowMs?: number): ClockReading;
    /** 시험용 — 측정 전 상태로 되돌린다. */
    reset(): void;
}
/** 프로세스 하나에 시각 상태 하나. */
export declare const serverClock: ServerClock;
/** DB 시계에 맞춘 지금. `new Date()` 대신 쓴다. */
export declare function serverNow(): Date;
/**
 * 표본 여러 개 중 왕복이 가장 짧은 것을 쓴다 (NTP 의 clock filter 와 같은 생각).
 * 왕복이 짧을수록 "DB 가 시각을 찍은 순간" 이 왕복의 한가운데라는 가정이 덜 틀린다.
 */
export declare function bestSample(probes: Array<{
    sentAtMs: number;
    receivedAtMs: number;
    dbTimeMs: number;
}>): ClockSample | null;
/**
 * clock offset 을 주기적으로 잰다 (§A9). Pod 마다 따로 잰다 — 노드마다 시계가 다르기 때문이다.
 * 측정 실패는 로그 한 번과 상태(UNMEASURED·STALE)로 드러낸다. DB 가 죽었으면 어차피 접수가 안 된다.
 */
export declare class ClockMonitor implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly logger;
    private timer;
    private failing;
    private lastStatus;
    /** 프로세스 공용 시각 상태에 기록한다. DI 로 받지 않는다 — 감사·마감·접수가 같은 값을 봐야 한다. */
    private readonly clock;
    constructor(db: Db);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    /** 한 번 잰다. 시험에서 직접 부른다. */
    sample(): Promise<ClockReading>;
}
