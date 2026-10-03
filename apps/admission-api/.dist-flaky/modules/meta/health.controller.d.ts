import { Db } from '@wonseoro/server-kit';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
/**
 * K-PaaS/Kubernetes probe. (v1.1 §05 — startup/readiness/liveness 필수)
 *
 * liveness 는 프로세스 생존만 본다. DB 가 죽었다고 Pod 를 죽이면
 * DB Failover 중에 전체 Pod 가 재시작되어 상황이 더 나빠진다.
 * readiness 만 DB 를 확인해 트래픽에서 빠진다.
 */
export declare class HealthController {
    private readonly db;
    private readonly breakers;
    constructor(db: Db, breakers: DependencyBreakers);
    live(): {
        service: string;
        status: string;
        time: string;
    };
    ready(): Promise<{
        service: string;
        status: string;
        time: string;
    }>;
    /**
     * 외부 의존성 Circuit Breaker 상태. (v1.1 §01 C8)
     *
     * **readiness 에 넣지 않는다.** 중앙이나 PG 가 죽었다고 readyz 가 실패하면
     * 모든 Pod 가 트래픽에서 빠져 접수 전체가 멈춘다. 끊는 이유가 바로 그걸 막는 것이다.
     * 여기서는 관제가 "무엇이 끊겼는가"를 볼 수 있게만 한다.
     *
     * Pod 마다 따로 판단하므로 이 값은 **이 Pod** 의 상태다.
     */
    dependencies(): {
        service: string;
        degraded: boolean;
        circuits: import("@wonseoro/server-kit").CircuitSnapshot[];
        clock: import("../../common/time/server-clock").ClockReading;
        time: string;
    };
}
