"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalCallback = exports.EXTERNAL_CALLBACK = void 0;
const common_1 = require("@nestjs/common");
exports.EXTERNAL_CALLBACK = 'wonseoro:external-callback';
/**
 * 외부 시스템(PG 등)이 부르는 경로. 전역 Idempotency-Key 강제에서 뺀다.
 *
 * PG 는 우리 헤더를 모른다. 대신 이런 경로는 **자기 쪽 이벤트 ID 로** 중복을 막아야 한다
 * (payment_event 의 provider_event_id 유니크). 이 표시를 붙이는 쪽이 그 책임을 진다.
 */
const ExternalCallback = () => (0, common_1.SetMetadata)(exports.EXTERNAL_CALLBACK, true);
exports.ExternalCallback = ExternalCallback;
//# sourceMappingURL=external-callback.decorator.js.map