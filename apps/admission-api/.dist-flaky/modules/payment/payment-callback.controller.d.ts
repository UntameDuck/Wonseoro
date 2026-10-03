import type { FastifyRequest } from 'fastify';
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
export declare class PaymentCallbackController {
    private readonly payments;
    private readonly provider;
    private readonly logger;
    constructor(payments: PaymentService, provider: PaymentProviderPort);
    receive(provider: string, req: FastifyRequest): Promise<{
        received: boolean;
        outcome: "UNKNOWN_TX" | "DUPLICATE" | "VERIFIED";
    }>;
}
