import { CentralHealthGate } from './central-health.gate';
/**
 * GET /api/v1/meta/operating-mode — 자율 운영 배너의 근거. (v1.1 §A1 "운영배너와 Sync Lag 표시")
 *
 * 지원자 화면이 주기적으로 묻는다. 인증 없이 열려 있으므로 **개인정보도,
 * 운영 내부 정보도 싣지 않는다.** 실패(DEAD) 건수, 회로 상태, 실패 원인은
 * `/healthz/dependencies` 에만 있다.
 *
 * 메모리의 마지막 확인 결과만 돌려준다. 이 조회가 DB 나 중앙에 닿지 않는다.
 *
 * 계약에 없는 경로다. (D-34)
 */
export declare class OperatingModeController {
    private readonly gate;
    constructor(gate: CentralHealthGate);
    operatingMode(): {
        mode: import("./central-health.gate").OperatingMode;
        reason: import("./central-health.gate").AutonomousReason | null;
        since: string;
        lastCentralContactAt: string | null;
        sync: {
            pendingEvents: number;
            oldestPendingAgeSeconds: number;
            lagging: boolean;
        };
        checkedAt: string;
        serverTime: string;
    };
}
