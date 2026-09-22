import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IncomingEvent, SyncGatewayService, SyncRejection } from './sync-gateway.service';

/**
 * 중앙 이벤트 수신 — canonical: k-admission-openapi.yaml
 *   ingestUniversityEvent / getEventReceipt
 *
 * 운영에서는 mTLS 로만 접근한다. (M5 T-M5-05)
 * M2 에서는 인증 없이 열려 있다. 외부에 노출하지 않는다.
 */
@Controller('internal/v1')
export class SyncGatewayController {
  constructor(private readonly gateway: SyncGatewayService) {}

  @Post('events')
  @HttpCode(202)
  @Header('cache-control', 'no-store')
  async ingest(@Body() event: IncomingEvent, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const result = await this.gateway.ingest(event);
      // 중복은 409 다. OpenAPI 가 "Duplicate event; existing receipt may be returned" 로 규정한다.
      // 오류가 아니라 "이미 받았다"는 뜻이므로 영수증을 함께 돌려준다.
      if (result.duplicate) reply.status(409);
      return {
        eventId: result.eventId,
        receiptId: result.receiptId,
        acknowledgedAt: result.acknowledgedAt,
        duplicate: result.duplicate,
      };
    } catch (err) {
      if (err instanceof SyncRejection) {
        throw new HttpException(
          {
            type: 'https://wonseoro.kr/problems/sync-rejected',
            title: '이벤트를 받을 수 없습니다',
            status: 400,
            code: err.reason,
            traceId: '',
            detail: err.detail,
          },
          400,
        );
      }
      throw err;
    }
  }

  @Get('events/:eventId/receipt')
  @Header('cache-control', 'no-store')
  async receipt(@Param('eventId') eventId: string) {
    const receipt = await this.gateway.receiptOf(eventId);
    if (!receipt) {
      throw new HttpException(
        {
          type: 'https://wonseoro.kr/problems/not-found',
          title: '수신 기록이 없습니다',
          status: 404,
          code: 'NOT_FOUND',
          traceId: '',
        },
        404,
      );
    }
    return receipt;
  }

  /** 관제용. 어느 대학이 밀려 있는가. */
  @Get('sync/status')
  @Header('cache-control', 'no-store')
  async status() {
    return { universities: await this.gateway.syncStatus() };
  }
}
