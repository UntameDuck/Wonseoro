import { Controller, Get, Post } from '@nestjs/common';
import { ScannerService } from './scanner.service';

@Controller()
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Get('healthz')
  live() {
    return { service: 'document-service', status: 'ok', time: new Date().toISOString() };
  }

  /** 시험·운영 수동 트리거. 주기 루프와 별개로 한 번 비운다. */
  @Post('internal/v1/scan/drain')
  drain() {
    return this.scanner.drainOnce();
  }
}
