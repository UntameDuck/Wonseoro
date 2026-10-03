import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { INTERNAL } from '../../config';
import { sameUniversity } from '../../internal-auth';
import { IncomingEvent, SyncGatewayService, SyncRejection } from './sync-gateway.service';

/**
 * 중앙 이벤트 수신 — canonical: k-admission-openapi.yaml
 *   ingestUniversityEvent / getEventReceipt
 *
 * 운영에서는 상호 TLS 로만 접근한다(T-M5-05, D-69) — 대학 Relay 인증서의 대학과 이벤트의 대학·출처가 같아야 받는다.
 * 다른 대학 이름으로 보낸 이벤트는 403. 영수증도 자기 대학이 보낸 이벤트 것만 보인다.
 */
@Controller('internal/v1')
export class SyncGatewayController {
  constructor(private readonly gateway: SyncGatewayService) {}

  @Post('events')
  @HttpCode(202)
  @Header('cache-control', 'no-store')
  async ingest(@Body() event: IncomingEvent, @Res({ passthrough: true }) reply: FastifyReply, @Req() req?: FastifyRequest) {
    sameUniversity(req, event?.kadmissionuniversity, '이벤트의 대학');
    sameUniversity(req, sourceUniversity(event?.source), '이벤트 출처');
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
  async receipt(@Param('eventId') eventId: string, @Req() req?: FastifyRequest) {
    const receipt = await this.gateway.receiptOf(eventId);
    // 다른 대학이 보낸 이벤트의 영수증은 없는 것처럼 — 남의 접수 흐름을 엿보지 못하게
    const foreign = INTERNAL.mode === 'mtls' && receipt && receipt.universityId !== req?.internalPeer?.universityId;
    if (!receipt || foreign) {
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

/** `urn:k-admission:university:UNIV-A` → `UNIV-A`. 모양이 다르면 null */
export function sourceUniversity(source: unknown): string | null {
  const m = typeof source === 'string' ? /^urn:k-admission:university:([A-Z0-9][A-Z0-9-]{1,31})$/.exec(source) : null;
  return m ? (m[1] as string) : null;
}
