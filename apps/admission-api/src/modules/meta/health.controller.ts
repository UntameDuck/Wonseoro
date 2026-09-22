import { Controller, Get } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { ProblemException } from '../../common/problem/problem.exception';

/**
 * K-PaaS/Kubernetes probe. (v1.1 §05 — startup/readiness/liveness 필수)
 *
 * liveness 는 프로세스 생존만 본다. DB 가 죽었다고 Pod 를 죽이면
 * DB Failover 중에 전체 Pod 가 재시작되어 상황이 더 나빠진다.
 * readiness 만 DB 를 확인해 트래픽에서 빠진다.
 */
@Controller()
export class HealthController {
  constructor(private readonly db: Db) {}

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
}
