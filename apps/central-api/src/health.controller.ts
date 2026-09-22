import { Controller, Get } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';

@Controller()
export class HealthController {
  constructor(private readonly db: Db) {}

  @Get('healthz')
  live() {
    return { service: 'central-api', status: 'ok', time: new Date().toISOString() };
  }

  @Get('readyz')
  async ready() {
    return {
      service: 'central-api',
      status: (await this.db.healthy()) ? 'ok' : 'degraded',
      time: new Date().toISOString(),
    };
  }
}
