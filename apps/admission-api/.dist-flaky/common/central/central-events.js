"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.centralApplicationId = centralApplicationId;
exports.finalizedEventData = finalizedEventData;
exports.cancelledEventData = cancelledEventData;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../config");
/**
 * 중앙으로 나가는 이벤트 본문 — canonical: packages/contracts/events/k-admission-cloudevents.schema.json
 * (노션 §04 첨부와 바이트가 같다). 스키마가 `additionalProperties: false` 라 필드를 더하면 계약 위반이다.
 * 본문은 여기서만 만든다. `central-events.test.ts` 가 스키마로 검증한다. (D-50)
 *
 * 이름·주민등록번호·연락처·주소·원서본문·첨부파일·취소 사유는 넣지 않는다. (v1.0 §6.2·§17.1, v1.1 §04)
 */
/**
 * 대학 내부 원서 UUID 를 중앙에 드러내지 않는 불투명 ID. 같은 원서의 이벤트는 같은 값이다. (v1.1 §A3·§A12)
 * 소금이 고정값이면 중앙이 대학 내부 식별자를 역산할 수 있어 가명처리의 의미가 사라진다 — 운영에서는 필수다.
 */
function centralApplicationId(applicationId) {
    return (0, node_crypto_1.createHash)('sha256').update(`${config_1.CENTRAL_ID_SALT}|${applicationId}`).digest('hex');
}
const integrity = (...parts) => `sha256:${(0, node_crypto_1.createHash)('sha256').update(parts.join('|')).digest('hex')}`;
function finalizedEventData(src) {
    return {
        applicationId: centralApplicationId(src.applicationId),
        ...(src.subjectRef ? { subjectRef: src.subjectRef } : {}),
        admissionYear: src.admissionYear,
        admissionTypeCode: src.admissionTypeCode,
        departmentCode: src.departmentCode,
        // 내 원서가 코드(`EARLY · CSE`) 대신 이름을 보이게 한다 (T-M5-51, U-7)
        ...(src.admissionTypeName ? { admissionTypeName: src.admissionTypeName.slice(0, 200) } : {}),
        ...(src.departmentName ? { departmentName: src.departmentName.slice(0, 200) } : {}),
        status: 'FINALIZED',
        requestedAt: src.requestedAt,
        paymentApprovedAt: src.paymentApprovedAt,
        finalizedAt: src.finalizedAt,
        applicationNumber: src.applicationNumber,
        integrityHash: integrity(src.applicationId, src.applicationNumber, src.finalizedAt),
    };
}
/**
 * 접수 전 취소. 중앙에는 "취소됐다" 는 사실과 사유 **분류**만 보낸다 — 지원자가 쓴 사유 문장은 개인정보일 수 있다.
 * 취소는 지원자 본인만 한다(v1.0 §5.6, D-7). 환불 필요 여부는 대학 예외 큐의 일이라 중앙에 보내지 않는다.
 */
function cancelledEventData(src) {
    return {
        applicationId: centralApplicationId(src.applicationId),
        cancelledAt: src.cancelledAt,
        reasonCode: 'APPLICANT_REQUEST',
        integrityHash: integrity(src.applicationId, 'CANCELLED', src.cancelledAt),
    };
}
//# sourceMappingURL=central-events.js.map