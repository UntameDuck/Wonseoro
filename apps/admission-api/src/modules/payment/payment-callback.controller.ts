import { Controller, HttpCode, Logger, Param, Post, Req } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ExternalCallback } from '../../common/idempotency/external-callback.decorator';
import { ProblemException } from '../../common/problem/problem.exception';
import { PaymentProviderPort } from './payment.provider';
import { PaymentService } from './payment.service';

/**
 * PG 콜백 — v1.1 §A4 "Callback + Provider Polling 이중 확인" (D-40)
 *
 * 인터넷에서 PG 가 부른다. 지원자 신원도 Idempotency-Key 도 없다.
 *   - 신원 대신 **서명**을 본다. 맞지 않으면 403 — 아무것도 조회하지 않는다
 *   - Idempotency-Key 대신 **PG 이벤트 ID** 로 중복을 막는다 (`@ExternalCallback`)
 *   - 서명이 맞아도 **본문의 상태를 믿지 않는다.** 서비스가 PG 에 다시 묻는다
 *
 * 서명이 맞으면 결과와 관계없이 200 이다. 우리가 모르는 거래·이미 받은 콜백에
 * 오류를 주면 PG 는 계속 다시 보낸다. 받았다는 사실과 처리 결과는 별개다.
 */
@Controller('api/v1/payments/callbacks')
export class PaymentCallbackController {
  private readonly logger = new Logger('pg-callback');

  constructor(
    private readonly payments: PaymentService,
    private readonly provider: PaymentProviderPort,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  @ExternalCallback()
  async receive(@Param('provider') provider: string, @Req() req: FastifyRequest) {
    if (provider !== this.provider.name) {
      throw ProblemException.forbidden('이 대학이 계약한 결제 대행사가 아닙니다.');
    }
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const signature = req.headers['x-pg-signature'];
    const notice = rawBody
      ? this.provider.verifyCallback(typeof signature === 'string' ? signature : undefined, rawBody)
      : null;
    if (!notice) {
      // 누가 보냈는지 모르는 요청이다. 원문은 남기지 않는다 — 위조 시도의 본문을 로그로 옮길 이유가 없다.
      this.logger.warn(`callback rejected: signature mismatch from ${req.ip ?? 'unknown'}`);
      throw ProblemException.forbidden('콜백 서명이 맞지 않습니다.');
    }

    const result = await this.payments.handleCallback({
      ...notice,
      rawHash: createHash('sha256').update(rawBody!).digest('hex'),
    });
    // 결제 상태는 돌려주지 않는다. PG 가 알아야 할 것은 "받았다" 뿐이다.
    return { received: true, outcome: result.outcome };
  }
}
