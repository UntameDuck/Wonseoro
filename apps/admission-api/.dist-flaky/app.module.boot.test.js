"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
/**
 * 모듈 조립 시험 — 실제 AppModule 로 의존성 그래프를 만든다.
 *
 * 단위·통합 시험은 서비스를 직접 `new` 로 만들어 Nest 의 의존성 주입을 거치지 않는다.
 * 그래서 "시험은 전부 통과하는데 서버가 뜨지 않는" 결함을 못 잡는다 — 실제로 생성자 기본값
 * 인자를 DI 가 풀지 못해 admission-api 가 기동하지 않은 적이 있다(ClockMonitor, 2026-09-30).
 *
 * DB 없이도 돈다 — 연결 풀은 첫 쿼리 때 연결한다. 주기 작업은 꺼서 타이머가 남지 않게 한다.
 */
process.env.UNIVERSITY_ID ??= 'UNIV-BOOT';
process.env.CLOCK_AUTOSTART = 'false';
process.env.PAYMENT_RECHECK_AUTOSTART = 'false';
process.env.RECON_SCHEDULE_AUTOSTART = 'false';
process.env.IDEMPOTENCY_PURGE_AUTOSTART = 'false';
process.env.CENTRAL_GATE_AUTOSTART = 'false';
process.env.S3_AUTO_CREATE_BUCKET = 'false';
let app = null;
(0, node_test_1.after)(async () => {
    await app?.close();
});
(0, node_test_1.describe)('AppModule 조립', () => {
    (0, node_test_1.it)('모든 provider 의 의존성이 풀린다 — 서버가 뜬다', async () => {
        const { NestFactory } = await Promise.resolve().then(() => __importStar(require('@nestjs/core')));
        const { AppModule } = await Promise.resolve().then(() => __importStar(require('./app.module')));
        app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
        const { ClockMonitor } = await Promise.resolve().then(() => __importStar(require('./common/time/server-clock')));
        const { ReconciliationService } = await Promise.resolve().then(() => __importStar(require('./modules/reconciliation/reconciliation.service')));
        strict_1.default.ok(app.get(ClockMonitor));
        // PG 정산 대조는 결제 모듈의 어댑터를 받아야 동작한다 — 빠지면 9번 대조가 조용히 꺼진다
        const reconciliation = app.get(ReconciliationService);
        strict_1.default.ok(reconciliation.provider, 'ReconciliationService 에 PG 어댑터가 주입되지 않았다');
        strict_1.default.ok(reconciliation.payments, 'ReconciliationService 에 결제 서비스가 주입되지 않았다');
    });
});
//# sourceMappingURL=app.module.boot.test.js.map