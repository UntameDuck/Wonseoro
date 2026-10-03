import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
import { PaymentService } from './payment.service';
export interface RecheckResult {
    /** 다른 Pod 가 돌고 있거나 PG 회로가 열려 이번 주기를 건너뛰었다. */
    skipped: 'LOCKED' | 'CIRCUIT_OPEN' | null;
    checked: number;
    confirmed: number;
}
/**
 * 결제 재확인 워커 — v1.1 §A4 "Provider Polling" (D-40)
 *
 * 지원자가 결제 직후 창을 닫아도 결제 확인은 저절로 끝나야 한다.
 * 화면이 `verify` 를 부를 때만 확인되면, 돈은 나갔는데 원서는 PENDING 인 채로 남는다.
 *
 * 대상 — **PENDING · UNKNOWN 만.**
 *   CREATED 는 결제창을 열기만 한 상태다. 대부분 결제하지 않은 채 끝난다 — 그걸 전부
 *   PG 에 물으면 마감 피크에 PG 호출이 결제 시도 수만큼 늘어난다. 결제가 실제로 일어났다면
 *   PG 콜백이 온다 (콜백 → 재조회). 콜백마저 끊기면 대조가 잡는다.
 *
 * 간격 — 결제마다 Backoff. 마지막 확인에서 30초 × 2^(확인 횟수−1), 최대 30분.
 *   PG 가 PENDING 을 오래 주는 거래 하나가 매 주기 PG 를 두드리지 않게 한다.
 *
 * 기한 — maxAgeHours 가 지난 결제는 더 묻지 않는다. 대조(PAYMENT_STATE_UNKNOWN_STALE)가
 *   사람에게 넘긴다. 끝없이 묻는 것은 해결이 아니다.
 *
 * **CONFIRMED가 되면 자동 Finalize listener가 접수한다.** 결제 의도 생성이 제출 의사 표시다. (D-42)
 */
export declare class PaymentRecheckWorker implements OnModuleInit, OnApplicationShutdown {
    private readonly db;
    private readonly payments;
    private readonly breakers;
    static readonly LOCK = "payment:recheck";
    private readonly logger;
    private timer;
    private running;
    constructor(db: Db, payments: PaymentService, breakers: DependencyBreakers);
    onModuleInit(): void;
    onApplicationShutdown(): void;
    private safeTick;
    tick(opts?: {
        batchSize?: number;
        maxAgeHours?: number;
    }): Promise<RecheckResult>;
    private run;
    /**
     * 지금 물어볼 차례인 결제. 확인 횟수는 `VERIFY_*` 이벤트로 센다 — 따로 칼럼을 두지 않는다.
     * 지수는 10 에서 자른다(30초 × 2^10 은 이미 30분을 넘는다).
     */
    private due;
}
