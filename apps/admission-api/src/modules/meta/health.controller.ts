import { Controller, Get } from '@nestjs/common';

/**
 * K-PaaS/Kubernetes probe 용. (v1.1 §05 — startup/readiness/liveness 필수)
 *
 * readyz 는 DB 연결 확인까지 포함해야 한다. DDL 배치(T-M1-01) 후 확장한다.
 */
@Controller()
export class HealthController {
  @Get('healthz')
  live() {
    return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
  }

  @Get('readyz')
  ready() {
    return { service: 'admission-api', status: 'ok', time: new Date().toISOString() };
  }
}
