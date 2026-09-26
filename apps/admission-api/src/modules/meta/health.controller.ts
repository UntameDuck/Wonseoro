import { Controller, Get } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';
import { DependencyBreakers } from '../../common/resilience/dependency-breakers';

/**
 * K-PaaS/Kubernetes probe. (v1.1 §05 — startup/readiness/liveness 필수)
 *
 * liveness 는 프로세스 생존만 본다. DB 가 죽었다고 Pod 를 죽이면
 * DB Failover 중에 전체 Pod 가 재시작되어 상황이 더 나빠진다.
 * readiness 만 DB 를 확인해 트래픽에서 빠진다.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly db: Db,
    private readonly breakers: DependencyBreakers,
  ) {}

  @Get('healthz')
  live() {
    return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
  }

  @Get('readyz')
  async ready() {
    if (!(await this.db.healthy())) {
      throw ProblemException.retryable('데이터베이스에 연결할 수 없습니다.');
    }
    return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
  }

  /**
   * 외부 의존성 Circuit Breaker 상태. (v1.1 §01 C8)
   *
   * **readiness 에 넣지 않는다.** 중앙이나 PG 가 죽었다고 readyz 가 실패하면
   * 모든 Pod 가 트래픽에서 빠져 접수 전체가 멈춘다. 끊는 이유가 바로 그걸 막는 것이다.
   * 여기서는 관제가 "무엇이 끊겼는가"를 볼 수 있게만 한다.
   *
   * Pod 마다 따로 판단하므로 이 값은 **이 Pod** 의 상태다.
   */
  @Get('healthz/dependencies')
  dependencies() {
    const circuits = this.breakers.snapshot();
    return {
      service: 'admission-api',
      degraded: circuits.some((c) => c.state !== 'CLOSED'),
      circuits,
      time: new Date().toISOString(),
    };
  }
}
