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
exports.ClockMonitor = exports.serverClock = exports.ServerClock = exports.MAX_CLOCK_OFFSET_MS = void 0;
exports.serverNow = serverNow;
exports.bestSample = bestSample;
const common_1 = require("@nestjs/common");
const api_1 = require("@opentelemetry/api");
const server_kit_1 = require("@wonseoro/server-kit");
const config_1 = require("../../config");
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
exports.MAX_CLOCK_OFFSET_MS = 1_000;
/**
 * 프로세스 안의 시각 상태. 서비스들이 생성자 주입 없이 쓴다 — 감사 기록·마감 판정·접수가
 * 모두 같은 값을 봐야 하고, 시험이 서비스를 직접 만들 때도 같은 규칙이 적용돼야 한다.
 * 측정은 `ClockMonitor` 가 채운다. 측정이 없으면 offset 0 (노드 시계 그대로)이다.
 */
class ServerClock {
    maxOffsetMs;
    staleAfterMs;
    offset = 0;
    uncertainty = null;
    sampledAtMs = null;
    lastSampleLocalMs = null;
    constructor(maxOffsetMs = exports.MAX_CLOCK_OFFSET_MS, staleAfterMs = config_1.CLOCK.intervalMs * 3) {
        this.maxOffsetMs = maxOffsetMs;
        this.staleAfterMs = staleAfterMs;
    }
    /** DB 시계에 맞춘 지금. */
    now() {
        return new Date(Date.now() - this.offset);
    }
    record(sample, localNowMs = Date.now()) {
        this.offset = sample.offsetMs;
        this.uncertainty = sample.uncertaintyMs;
        this.sampledAtMs = sample.dbTimeMs;
        this.lastSampleLocalMs = localNowMs;
    }
    reading(localNowMs = Date.now()) {
        const base = {
            offsetMs: Math.round(this.offset),
            uncertaintyMs: this.uncertainty === null ? null : Math.round(this.uncertainty),
            sampledAt: this.sampledAtMs === null ? null : new Date(this.sampledAtMs).toISOString(),
            source: 'db',
        };
        if (this.lastSampleLocalMs === null)
            return { status: 'UNMEASURED', ...base };
        // 불확실성을 빼고도 넘으면 확실히 넘은 것이다. 부하 중 왕복이 길어 생긴 오차로 노드를 빼지 않는다.
        if (Math.abs(this.offset) - (this.uncertainty ?? 0) > this.maxOffsetMs) {
            return { status: 'OFFSET_EXCEEDED', ...base };
        }
        if (localNowMs - this.lastSampleLocalMs > this.staleAfterMs)
            return { status: 'STALE', ...base };
        return { status: 'SYNCED', ...base };
    }
    /** 시험용 — 측정 전 상태로 되돌린다. */
    reset() {
        this.offset = 0;
        this.uncertainty = null;
        this.sampledAtMs = null;
        this.lastSampleLocalMs = null;
    }
}
exports.ServerClock = ServerClock;
/** 프로세스 하나에 시각 상태 하나. */
exports.serverClock = new ServerClock();
/** DB 시계에 맞춘 지금. `new Date()` 대신 쓴다. */
function serverNow() {
    return exports.serverClock.now();
}
/**
 * 표본 여러 개 중 왕복이 가장 짧은 것을 쓴다 (NTP 의 clock filter 와 같은 생각).
 * 왕복이 짧을수록 "DB 가 시각을 찍은 순간" 이 왕복의 한가운데라는 가정이 덜 틀린다.
 */
function bestSample(probes) {
    let best = null;
    let bestRtt = Infinity;
    for (const p of probes) {
        const rtt = p.receivedAtMs - p.sentAtMs;
        if (!Number.isFinite(rtt) || rtt < 0)
            continue;
        if (rtt < bestRtt) {
            bestRtt = rtt;
            const midpoint = p.sentAtMs + rtt / 2;
            best = { offsetMs: midpoint - p.dbTimeMs, uncertaintyMs: rtt / 2, dbTimeMs: p.dbTimeMs };
        }
    }
    return best;
}
/**
 * clock offset 을 주기적으로 잰다 (§A9). Pod 마다 따로 잰다 — 노드마다 시계가 다르기 때문이다.
 * 측정 실패는 로그 한 번과 상태(UNMEASURED·STALE)로 드러낸다. DB 가 죽었으면 어차피 접수가 안 된다.
 */
let ClockMonitor = class ClockMonitor {
    db;
    logger = new common_1.Logger('server-clock');
    timer = null;
    failing = false;
    lastStatus = 'UNMEASURED';
    /** 프로세스 공용 시각 상태에 기록한다. DI 로 받지 않는다 — 감사·마감·접수가 같은 값을 봐야 한다. */
    clock = exports.serverClock;
    constructor(db) {
        this.db = db;
        const meter = api_1.metrics.getMeter('k-admission.clock');
        meter
            .createObservableGauge('clock_offset_ms', {
            description: '이 노드 시계 − DB 시계 (§A9). 허용오차 1000ms 를 넘으면 Finalize 를 받지 않는다',
            unit: 'ms',
        })
            .addCallback((result) => {
            const r = this.clock.reading();
            // 재지 못한 값은 내지 않는다. 0 을 내면 "동기화됨" 으로 오해한다.
            if (r.status !== 'UNMEASURED')
                result.observe(r.offsetMs);
        });
    }
    onModuleInit() {
        if (!config_1.CLOCK.autostart)
            return;
        void this.sample();
        this.timer = setInterval(() => void this.sample(), config_1.CLOCK.intervalMs);
        this.timer.unref();
    }
    onApplicationShutdown() {
        if (this.timer)
            clearInterval(this.timer);
    }
    /** 한 번 잰다. 시험에서 직접 부른다. */
    async sample() {
        try {
            const probes = [];
            for (let i = 0; i < config_1.CLOCK.probesPerSample; i += 1) {
                const sentAtMs = Date.now();
                const { rows } = await this.db.query(`SELECT clock_timestamp() AS now`);
                const receivedAtMs = Date.now();
                const dbTime = rows[0]?.now;
                if (dbTime)
                    probes.push({ sentAtMs, receivedAtMs, dbTimeMs: dbTime.getTime() });
            }
            const best = bestSample(probes);
            if (best)
                this.clock.record(best);
            if (this.failing)
                this.logger.log('DB 시각 측정 복구');
            this.failing = false;
        }
        catch (err) {
            if (!this.failing)
                this.logger.warn(`DB 시각을 재지 못했다: ${(0, server_kit_1.describeFailure)(err)}`);
            this.failing = true;
        }
        const reading = this.clock.reading();
        if (reading.status !== this.lastStatus) {
            const line = `clock ${this.lastStatus} -> ${reading.status} (offset=${reading.offsetMs}ms ±${reading.uncertaintyMs ?? '?'}ms)`;
            if (reading.status === 'OFFSET_EXCEEDED') {
                this.logger.error(`${line} — 이 노드는 접수를 확정하지 않는다`);
            }
            else {
                this.logger.warn(line);
            }
            this.lastStatus = reading.status;
        }
        return reading;
    }
};
exports.ClockMonitor = ClockMonitor;
exports.ClockMonitor = ClockMonitor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [server_kit_1.Db])
], ClockMonitor);
//# sourceMappingURL=server-clock.js.map