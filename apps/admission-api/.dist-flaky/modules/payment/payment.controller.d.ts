import type { FastifyReply, FastifyRequest } from 'fastify';
import { Ownership } from '../../common/identity/ownership.service';
import { PaymentService } from './payment.service';
/**
 * 결제 API — canonical: k-admission-openapi.yaml
 *   createPaymentIntent / getPayment / verifyPayment
 */
export declare class PaymentController {
    private readonly payments;
    private readonly ownership;
    constructor(payments: PaymentService, ownership: Ownership);
    /**
     * 새 결제창은 201, 이미 열린 결제창을 다시 여는 것은 200 이다 (한 원서에 살아 있는 결제는 하나).
     * 확인 중·확정된 결제가 있으면 409 PAYMENT_IN_PROGRESS — 화면은 결제 상태 확인으로 안내한다.
     */
    createIntent(applicationId: string, req: FastifyRequest, reply: FastifyReply): Promise<{
        paymentId: string;
        amount: number;
        currency: string;
        provider: string;
        providerPayload: Record<string, unknown>;
    }>;
    get(paymentId: string, req: FastifyRequest): Promise<{
        id: string;
        status: "FAILED" | "CANCELLED" | "CONFIRMED" | "UNKNOWN" | "PENDING" | "CREATED" | "REFUNDED";
        amount: number;
        currency: string;
        provider: string;
        providerApprovedAt: string | null;
        verifiedAt: string | null;
    }>;
    /**
     * 서버측 재검증.
     *
     * 상태를 확정하지 못하면 202 를 준다. (OpenAPI 가 202 를 명시한다)
     * 400·500 으로 돌려주면 화면이 "실패"로 보이고 사용자가 재결제한다.
     * 중복 결제가 확인 지연보다 훨씬 큰 사고다. (v1.1 §B4)
     */
    verify(paymentId: string, req: FastifyRequest, reply: FastifyReply): Promise<{
        id: string;
        status: "FAILED" | "CANCELLED" | "CONFIRMED" | "UNKNOWN" | "PENDING" | "CREATED" | "REFUNDED";
        amount: number;
        currency: string;
        provider: string;
        providerApprovedAt: string | null;
        verifiedAt: string | null;
    }>;
    private present;
    private context;
}
