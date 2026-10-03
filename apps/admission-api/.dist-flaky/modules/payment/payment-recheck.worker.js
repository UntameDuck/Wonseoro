"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PaymentRecheckWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentRecheckWorker = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const leader_lock_1 = require("../../common/scheduling/leader-lock");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const config_1 = require("../../config");
const payment_service_1 = require("./payment.service");
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
let PaymentRecheckWorker = class PaymentRecheckWorker {
    static { PaymentRecheckWorker_1 = this; }
    db;
    payments;
    breakers;
    static LOCK = 'payment:recheck';
    logger = new common_1.Logger('payment-recheck');
    timer = null;
    running = false;
    constructor(db, payments, breakers) {
        this.db = db;
        this.payments = payments;
        this.breakers = breakers;
    }
    onModuleInit() {
        if (!config_1.PAYMENT_RECHECK.autostart)
            return;
        this.timer = setInterval(() => void this.safeTick(), config_1.PAYMENT_RECHECK.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async safeTick() {
        try {
            await this.tick();
        }
        catch (err) {
            // 한 주기가 실패해도 다음 주기는 돈다. DB 가 잠깐 끊긴 것으로 워커가 멈추면 안 된다.
            this.logger.warn(`recheck tick failed (${(0, server_kit_1.describeFailure)(err)})`);
        }
    }
    async tick(opts = {}) {
        const empty = (skipped) => ({ skipped, checked: 0, confirmed: 0 });
        if (this.running)
            return empty('LOCKED');
        // 회로가 열려 있으면 묻지 않는다. 물어도 "모른다" 만 쌓인다.
        // 반열림이면 이 주기가 탐침이 된다 — 지원자 요청이 탐침을 떠안지 않는다.
        if (!this.breakers.paymentGateway.allowsRequest())
            return empty('CIRCUIT_OPEN');
        this.running = true;
        try {
            const result = await (0, leader_lock_1.withLeaderLock)(this.db, PaymentRecheckWorker_1.LOCK, () => this.run(opts.batchSize ?? config_1.PAYMENT_RECHECK.batchSize, opts.maxAgeHours ?? config_1.PAYMENT_RECHECK.maxAgeHours));
            return result ?? empty('LOCKED');
        }
        finally {
            this.running = false;
        }
    }
    async run(batchSize, maxAgeHours) {
        const due = await this.due(batchSize, maxAgeHours);
        let confirmed = 0;
        for (const id of due) {
            try {
                const p = await this.payments.verify(id, {});
                if (p.status === 'CONFIRMED')
                    confirmed += 1;
            }
            catch (err) {
                // 한 건 때문에 나머지를 멈추지 않는다.
                this.logger.warn(`recheck ${id} failed (${(0, server_kit_1.describeFailure)(err)})`);
            }
            // 확인 도중 회로가 열리면 남은 건은 다음 주기로 넘긴다.
            if (!this.breakers.paymentGateway.allowsRequest())
                break;
        }
        if (confirmed > 0)
            this.logger.log(`recheck: ${due.length}건 확인, ${confirmed}건 결제 확인됨`);
        return { skipped: null, checked: due.length, confirmed };
    }
    /**
     * 지금 물어볼 차례인 결제. 확인 횟수는 `VERIFY_*` 이벤트로 센다 — 따로 칼럼을 두지 않는다.
     * 지수는 10 에서 자른다(30초 × 2^10 은 이미 30분을 넘는다).
     */
    async due(batchSize, maxAgeHours) {
        const { rows } = await this.db.query(`SELECT p.id
         FROM payment p
         CROSS JOIN LATERAL (
           SELECT count(*)::int AS n FROM payment_event e
            WHERE e.payment_id = p.id AND e.event_type LIKE 'VERIFY\\_%'
         ) v
        WHERE p.status IN ('PENDING','UNKNOWN')
          AND p.provider_tx_id IS NOT NULL
          AND p.created_at > now() - make_interval(hours => $2)
          AND COALESCE(p.verified_at, p.created_at)
              + LEAST(interval '30 seconds' * power(2, LEAST(GREATEST(v.n - 1, 0), 10)),
                      interval '30 minutes') <= now()
        ORDER BY COALESCE(p.verified_at, p.created_at)
        LIMIT $1`, [batchSize, maxAgeHours]);
        return rows.map((r) => r.id);
    }
};
exports.PaymentRecheckWorker = PaymentRecheckWorker;
exports.PaymentRecheckWorker = PaymentRecheckWorker = PaymentRecheckWorker_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        payment_service_1.PaymentService,
        dependency_breakers_1.DependencyBreakers])
], PaymentRecheckWorker);
//# sourceMappingURL=payment-recheck.worker.js.map