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
exports.PaymentCallbackController = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const external_callback_decorator_1 = require("../../common/idempotency/external-callback.decorator");
const problem_exception_1 = require("../../common/problem/problem.exception");
const payment_provider_1 = require("./payment.provider");
const payment_service_1 = require("./payment.service");
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
let PaymentCallbackController = class PaymentCallbackController {
    payments;
    provider;
    logger = new common_1.Logger('pg-callback');
    constructor(payments, provider) {
        this.payments = payments;
        this.provider = provider;
    }
    async receive(provider, req) {
        if (provider !== this.provider.name) {
            throw problem_exception_1.ProblemException.forbidden('이 대학이 계약한 결제 대행사가 아닙니다.');
        }
        const rawBody = req.rawBody;
        const signature = req.headers['x-pg-signature'];
        const notice = rawBody
            ? this.provider.verifyCallback(typeof signature === 'string' ? signature : undefined, rawBody)
            : null;
        if (!notice) {
            // 누가 보냈는지 모르는 요청이다. 원문은 남기지 않는다 — 위조 시도의 본문을 로그로 옮길 이유가 없다.
            this.logger.warn(`callback rejected: signature mismatch from ${req.ip ?? 'unknown'}`);
            throw problem_exception_1.ProblemException.forbidden('콜백 서명이 맞지 않습니다.');
        }
        const result = await this.payments.handleCallback({
            ...notice,
            rawHash: (0, node_crypto_1.createHash)('sha256').update(rawBody).digest('hex'),
        });
        // 결제 상태는 돌려주지 않는다. PG 가 알아야 할 것은 "받았다" 뿐이다.
        return { received: true, outcome: result.outcome };
    }
};
exports.PaymentCallbackController = PaymentCallbackController;
__decorate([
    (0, common_1.Post)(':provider'),
    (0, common_1.HttpCode)(200),
    (0, external_callback_decorator_1.ExternalCallback)(),
    __param(0, (0, common_1.Param)('provider')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PaymentCallbackController.prototype, "receive", null);
exports.PaymentCallbackController = PaymentCallbackController = __decorate([
    (0, common_1.Controller)('api/v1/payments/callbacks'),
    __metadata("design:paramtypes", [payment_service_1.PaymentService,
        payment_provider_1.PaymentProviderPort])
], PaymentCallbackController);
//# sourceMappingURL=payment-callback.controller.js.map