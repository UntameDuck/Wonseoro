import { Controller, Get, Header, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII } from '@wonseoro/contracts';
import { applicantFrom } from '../../common/identity/identity';
import { Ownership } from '../../common/identity/ownership.service';
import { PaymentRow, PaymentService } from './payment.service';

/**
 * 결제 API — canonical: k-admission-openapi.yaml
 *   createPaymentIntent / getPayment / verifyPayment
 */
@Controller('api/v1')
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly ownership: Ownership,
  ) {}

  @Post('applications/:applicationId/payment-intents')
  @HttpCode(201)
  @Header('cache-control', CACHE_CONTROL_PII)
  async createIntent(
    @Param('applicationId') applicationId: string,
    @Req() req: FastifyRequest,
  ) {
    const { applicantId } = applicantFrom(req);
    await this.ownership.assertApplication(applicationId, applicantId);

    const { payment, providerPayload } = await this.payments.createIntent(
      applicationId,
      applicantId,
      this.context(req),
    );
    return {
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPayload,
    };
  }

  @Get('payments/:paymentId')
  @Header('cache-control', CACHE_CONTROL_PII)
  async get(@Param('paymentId') paymentId: string, @Req() req: FastifyRequest) {
    await this.ownership.assertPayment(paymentId, applicantFrom(req).applicantId);
    return this.present(await this.payments.load(paymentId));
  }

  /**
   * 서버측 재검증.
   *
   * 상태를 확정하지 못하면 202 를 준다. (OpenAPI 가 202 를 명시한다)
   * 400·500 으로 돌려주면 화면이 "실패"로 보이고 사용자가 재결제한다.
   * 중복 결제가 확인 지연보다 훨씬 큰 사고다. (v1.1 §B4)
   */
  @Post('payments/:paymentId/verify')
  // OpenAPI verifyPayment 는 200(확정) / 202(상태 미확정) 를 규정한다. 201 이 아니다.
  @HttpCode(200)
  @Header('cache-control', CACHE_CONTROL_PII)
  async verify(
    @Param('paymentId') paymentId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // 재검증은 상태를 바꾼다. 남의 결제를 건드릴 수 있으면 안 된다.
    await this.ownership.assertPayment(paymentId, applicantFrom(req).applicantId);

    const payment = await this.payments.verify(paymentId, this.context(req));
    if (payment.status === 'UNKNOWN' || payment.status === 'PENDING') {
      reply.status(202);
    }
    return this.present(payment);
  }

  private present(p: PaymentRow) {
    return {
      id: p.id,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      providerApprovedAt: p.providerApprovedAt,
      verifiedAt: p.verifiedAt,
    };
  }

  private context(req: FastifyRequest): { traceId?: string; sourceIp?: string } {
    const tp = req.headers.traceparent;
    const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
    return {
      ...(traceId ? { traceId } : {}),
      ...(req.ip ? { sourceIp: req.ip } : {}),
    };
  }
}
