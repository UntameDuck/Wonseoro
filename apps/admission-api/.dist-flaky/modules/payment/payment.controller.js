"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentController = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const identity_1 = require("../../common/identity/identity");
const ownership_service_1 = require("../../common/identity/ownership.service");
const payment_service_1 = require("./payment.service");
/**
 * 결제 API — canonical: k-admission-openapi.yaml
 *   createPaymentIntent / getPayment / verifyPayment
 */
let PaymentController = class PaymentController {
    payments;
    ownership;
    constructor(payments, ownership) {
        this.payments = payments;
        this.ownership = ownership;
    }
    /**
     * 새 결제창은 201, 이미 열린 결제창을 다시 여는 것은 200 이다 (한 원서에 살아 있는 결제는 하나).
     * 확인 중·확정된 결제가 있으면 409 PAYMENT_IN_PROGRESS — 화면은 결제 상태 확인으로 안내한다.
     */
    async createIntent(applicationId, req, reply) {
        const { applicantId } = (0, identity_1.applicantFrom)(req);
        await this.ownership.assertApplication(applicationId, applicantId);
        const { payment, providerPayload, created } = await this.payments.createIntent(applicationId, applicantId, this.context(req));
        reply.status(created ? 201 : 200);
        return {
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            provider: payment.provider,
            providerPayload,
        };
    }
    async get(paymentId, req) {
        await this.ownership.assertPayment(paymentId, (0, identity_1.applicantFrom)(req).applicantId);
        return this.present(await this.payments.load(paymentId));
    }
    /**
     * 서버측 재검증.
     *
     * 상태를 확정하지 못하면 202 를 준다. (OpenAPI 가 202 를 명시한다)
     * 400·500 으로 돌려주면 화면이 "실패"로 보이고 사용자가 재결제한다.
     * 중복 결제가 확인 지연보다 훨씬 큰 사고다. (v1.1 §B4)
     */
    async verify(paymentId, req, reply) {
        // 재검증은 상태를 바꾼다. 남의 결제를 건드릴 수 있으면 안 된다.
        await this.ownership.assertPayment(paymentId, (0, identity_1.applicantFrom)(req).applicantId);
        const payment = await this.payments.verify(paymentId, this.context(req));
        if (payment.status === 'UNKNOWN' || payment.status === 'PENDING') {
            reply.status(202);
        }
        return this.present(payment);
    }
    present(p) {
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
    context(req) {
        const tp = req.headers.traceparent;
        const traceId = typeof tp === 'string' ? tp.split('-')[1] : undefined;
        return {
            ...(traceId ? { traceId } : {}),
            ...(req.ip ? { sourceIp: req.ip } : {}),
        };
    }
};
exports.PaymentController = PaymentController;
__decorate([
    (0, common_1.Post)('applications/:applicationId/payment-intents'),
    (0, common_1.HttpCode)(201),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('applicationId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "createIntent", null);
__decorate([
    (0, common_1.Get)('payments/:paymentId'),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('paymentId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('payments/:paymentId/verify')
    // OpenAPI verifyPayment 는 200(확정) / 202(상태 미확정) 를 규정한다. 201 이 아니다.
    ,
    (0, common_1.HttpCode)(200),
    (0, common_1.Header)('cache-control', contracts_1.CACHE_CONTROL_PII),
    __param(0, (0, common_1.Param)('paymentId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "verify", null);
exports.PaymentController = PaymentController = __decorate([
    (0, common_1.Controller)('api/v1'),
    __metadata("design:paramtypes", [payment_service_1.PaymentService,
        ownership_service_1.Ownership])
], PaymentController);
//# sourceMappingURL=payment.controller.js.map