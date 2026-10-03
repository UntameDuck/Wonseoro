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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CentralHealthGate = void 0;
const common_1 = require("@nestjs/common");
const server_kit_1 = require("@wonseoro/server-kit");
const dependency_breakers_1 = require("../../common/resilience/dependency-breakers");
const config_1 = require("../../config");
/**
 * Central Dependency Health Gate — 기술설계서 v1.1 §01 A1·C3
 *
 * **이 대학 서버가 지금 중앙 없이 돌고 있는가**를 판단해 둔다.
 *
 * 판단이 바꾸는 것은 **안내뿐이다.** 접수 경로는 원래 중앙을 거치지 않는다.
 * AUTONOMOUS 라고 해서 막히는 기능이 생기면 안 되고, 실제로 없다.
 * 이 판단이 필요한 이유는 사람 쪽이다.
 *   - 지원자는 "내 원서" (중앙 통합 조회) 에 접수가 안 보이면 접수가 안 된 줄 알고
 *     다시 결제하거나 입학처에 전화한다. 먼저 알려줘야 한다
 *   - 운영자는 중앙이 언제부터 끊겼고 얼마나 밀렸는지 알아야 한다. (§B7)
 *
 * 화면 조회는 메모리의 마지막 확인 결과만 읽는다. 마감 피크에 수천 명이
 * 물어도 중앙과 DB 에는 CENTRAL_GATE_INTERVAL_MS 간격으로만 간다.
 *
 * 판단은 Pod 마다 따로 한다. 같은 대학의 Pod 끼리 잠깐 다르게 보일 수 있지만,
 * 공유 저장소에 두면 그것이 새 의존성이 된다.
 */
let CentralHealthGate = class CentralHealthGate {
    db;
    breakers;
    logger = new common_1.Logger('autonomous');
    timer = null;
    running = false;
    /** 시험에서 바꿀 수 있게 필드로 둔다. */
    centralUrl = config_1.CENTRAL_SYNC_URL;
    state;
    /** 적체 경보를 한 번만 내기 위해. 매 주기 같은 경보를 남기면 로그가 묻힌다. */
    lagAlarmRaised = false;
    /**
     * AUTONOMOUS 경보를 냈는가.
     * 모드 "전환" 만 보면 기동할 때부터 중앙이 없던 경우를 놓친다 — 초기 상태가 이미
     * AUTONOMOUS 라 전환이 일어나지 않는다. 운영자가 가장 알아야 할 경우가 그것이다.
     */
    autonomousAnnounced = false;
    constructor(db, breakers) {
        this.db = db;
        this.breakers = breakers;
        const now = new Date().toISOString();
        // 첫 확인 전에는 연결됐다고 가정하지 않는다. 모르는 것을 안다고 말하지 않는다.
        this.state = {
            mode: 'AUTONOMOUS',
            reason: this.centralUrl ? 'CENTRAL_UNREACHABLE' : 'CENTRAL_NOT_CONFIGURED',
            since: now,
            lastCentralContactAt: null,
            sync: { pendingEvents: 0, oldestPendingAgeSeconds: 0, deadEvents: 0, lagging: false },
            checkedAt: now,
        };
    }
    onModuleInit() {
        if (!config_1.CENTRAL_GATE.autostart)
            return;
        void this.tick();
        this.timer = setInterval(() => void this.tick(), config_1.CENTRAL_GATE.intervalMs);
        // 이 타이머 때문에 프로세스가 안 끝나면 안 된다.
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    current() {
        return this.state;
    }
    /**
     * 한 주기. 중앙을 확인하고 적체를 센다.
     * `probe` 는 시험에서 중앙 응답을 흉내 내려고 받는다.
     */
    async tick(probe = () => this.httpProbe()) {
        if (this.running)
            return this.state;
        this.running = true;
        try {
            const reachable = await this.checkCentral(probe);
            const sync = await this.readBacklog().catch((err) => {
                // DB 를 못 읽으면 적체는 모른다. 지난 값을 그대로 두고 경고만 한다.
                this.logger.warn(`outbox backlog unavailable (${(0, server_kit_1.describeFailure)(err)})`);
                return this.state.sync;
            });
            this.update(reachable, sync);
            return this.state;
        }
        finally {
            this.running = false;
        }
    }
    async checkCentral(probe) {
        if (!this.centralUrl)
            return false;
        const breaker = this.breakers.centralHealth;
        // 회로가 열려 있으면 묻지 않는다. 반열림이 되면 이 주기 확인이 탐침이 된다 —
        // 지원자 요청이 탐침 역할을 떠안지 않는다.
        if (!breaker.allowsRequest())
            return false;
        try {
            const res = await breaker.run(probe, { isFailure: server_kit_1.httpServerError });
            return res.ok;
        }
        catch (err) {
            if (!(err instanceof server_kit_1.CircuitOpenError)) {
                this.logger.debug(`central probe failed (${(0, server_kit_1.describeFailure)(err)})`);
            }
            return false;
        }
    }
    httpProbe() {
        // 중앙이 HTTPS(플랫폼 CA)면 같은 클라이언트로 — 상대 인증서를 플랫폼 CA 로 검증한다
        return (0, server_kit_1.internalHttp)().fetch(`${this.centralUrl}/readyz`, { signal: AbortSignal.timeout(config_1.VAULT_TIMEOUT_MS) });
    }
    /**
     * Outbox 적체. relay 는 별도 프로세스지만 같은 DB 를 보므로 여기서 직접 센다.
     * relay 가 죽어도 적체는 보여야 한다 — relay 에 물으면 그때 함께 안 보인다.
     */
    async readBacklog() {
        const { rows } = await this.db.query(`SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING')) AS pending,
              count(*) FILTER (WHERE status = 'DEAD') AS dead,
              COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)
                FILTER (WHERE status IN ('PENDING','SENDING')))), 0) AS oldest
         FROM outbox_event`);
        const r = rows[0] ?? {};
        const oldest = Math.floor(Number(r.oldest ?? 0));
        return {
            pendingEvents: Number(r.pending ?? 0),
            oldestPendingAgeSeconds: oldest,
            deadEvents: Number(r.dead ?? 0),
            lagging: oldest >= config_1.CENTRAL_GATE.syncLagWarnSeconds,
        };
    }
    update(reachable, sync) {
        const now = new Date().toISOString();
        const prev = this.state;
        let mode;
        if (!this.centralUrl)
            mode = 'AUTONOMOUS';
        else if (reachable)
            mode = 'CONNECTED';
        // 한 번 실패로 넘기지 않는다. 회로가 열려야 넘긴다 —
        // 순간적인 실패에 배너가 깜빡이면 지원자는 그때마다 불안해진다.
        else if (this.breakers.centralHealth.state === 'CLOSED')
            mode = prev.mode;
        else
            mode = 'AUTONOMOUS';
        let reason = null;
        if (mode === 'AUTONOMOUS') {
            reason = this.centralUrl ? 'CENTRAL_UNREACHABLE' : 'CENTRAL_NOT_CONFIGURED';
        }
        this.state = {
            mode,
            reason,
            since: mode === prev.mode ? prev.since : now,
            lastCentralContactAt: reachable ? now : prev.lastCentralContactAt,
            sync,
            checkedAt: now,
        };
        this.reportMode(prev, this.state);
        this.reportLag(sync);
    }
    reportMode(prev, next) {
        if (next.mode === 'AUTONOMOUS') {
            // 확정됐을 때 한 번만. 기동 직후 첫 실패 한 번으로는 아직 모른다.
            const settled = !this.centralUrl || this.breakers.centralHealth.state !== 'CLOSED';
            if (settled && !this.autonomousAnnounced) {
                this.autonomousAnnounced = true;
                // 운영자가 찾을 문장이다. 접수가 멈춘 것이 아니라는 것을 같이 남긴다.
                this.logger.error(`AUTONOMOUS (${next.reason}) — 접수는 계속된다. 중앙 통합 조회 반영만 멈춘다`);
            }
            return;
        }
        if (prev.mode === 'AUTONOMOUS') {
            this.autonomousAnnounced = false;
            const seconds = Math.round((Date.parse(next.since) - Date.parse(prev.since)) / 1000);
            this.logger.warn(`CONNECTED 복귀 — 자율 운영 ${seconds}s, 미전송 ${next.sync.pendingEvents}건`);
        }
    }
    /** 적체 경보는 넘어설 때 한 번, 풀릴 때 한 번. (§B7 backlog age alert) */
    reportLag(sync) {
        if (sync.lagging && !this.lagAlarmRaised) {
            this.lagAlarmRaised = true;
            this.logger.error(`중앙 반영 지연 — 가장 오래된 미전송 ${sync.oldestPendingAgeSeconds}s, ${sync.pendingEvents}건`);
        }
        else if (!sync.lagging && this.lagAlarmRaised) {
            this.lagAlarmRaised = false;
            this.logger.warn(`중앙 반영 지연 해소 — 미전송 ${sync.pendingEvents}건`);
        }
    }
};
exports.CentralHealthGate = CentralHealthGate;
exports.CentralHealthGate = CentralHealthGate = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db,
        dependency_breakers_1.DependencyBreakers])
], CentralHealthGate);
//# sourceMappingURL=central-health.gate.js.map