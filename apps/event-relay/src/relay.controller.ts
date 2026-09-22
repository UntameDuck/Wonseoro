import { Controller, Get, Header, Post } from '@nestjs/common';
import { RelayService } from './relay.service';

/**
 * canonical: k-admission-openapi.yaml — getSyncStatus
 * `GET /internal/v1/sync/status` 는 **대학 쪽** 상태다.
 * 중앙이 "이 대학이 얼마나 밀려 있나"를 묻는 데 쓴다.
 */
@Controller()
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Get('healthz')
  live() {
    return { service: 'event-relay', status: 'ok', time: new Date().toISOString() };
  }

  @Get('internal/v1/sync/status')
  @Header('cache-control', 'no-store')
  async status() {
    return this.relay.backlog();
  }

  /** 시험·운영 수동 트리거. 주기 루프와 별개로 한 번 비운다. */
  @Post('internal/v1/sync/drain')
  async drain() {
    return this.relay.drainOnce();
  }
}
