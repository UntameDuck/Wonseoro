"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const _2020_1 = __importDefault(require("ajv/dist/2020"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const central_events_1 = require("./central-events");
/**
 * 중앙 이벤트 본문 = CloudEvents 스키마 (D-50).
 *
 * 스키마는 노션 §04 첨부와 바이트가 같은 canonical 계약이다. 전에는 취소 이벤트가 applicationId·reasonCode·
 * integrityHash 없이 나가 중앙이 전부 400 으로 거절했고(로컬 DB 에 DEAD 6건), 접수 이벤트는 스키마에 없는
 * universityId·submittedAt 을 실었다. 본문을 만드는 함수를 스키마로 직접 검증한다.
 */
const schema = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '../../../../../packages/contracts/events/k-admission-cloudevents.schema.json'), 'utf8'));
const ajv = new _2020_1.default({ allErrors: true, strict: false });
(0, ajv_formats_1.default)(ajv);
ajv.addSchema(schema);
const validate = (def, data) => {
    const check = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
    const ok = check(data);
    return { ok, errors: JSON.stringify(check.errors) };
};
const APP = '84f21d99-750b-4b4d-a43c-f8acb30672bd';
(0, node_test_1.describe)('중앙 이벤트 본문은 CloudEvents 스키마를 따른다 (D-50)', () => {
    (0, node_test_1.it)('접수 이벤트', () => {
        const data = (0, central_events_1.finalizedEventData)({
            applicationId: APP,
            subjectRef: `k1.${'A'.repeat(43)}`,
            admissionYear: 2027,
            admissionTypeCode: 'EARLY',
            departmentCode: 'CSE',
            applicationNumber: '2027-A-ABCDEF',
            requestedAt: '2026-09-11T08:59:40Z',
            paymentApprovedAt: '2026-09-11T08:59:30Z',
            finalizedAt: '2026-09-11T08:59:42Z',
        });
        const { ok, errors } = validate('ApplicationFinalizedData', data);
        strict_1.default.ok(ok, errors);
    });
    (0, node_test_1.it)('접수 이벤트에 전형·모집단위 표시 이름을 싣는다 — 내 원서가 코드 대신 이름을 보인다 (T-M5-51)', () => {
        const data = (0, central_events_1.finalizedEventData)({
            applicationId: APP,
            admissionYear: 2027,
            admissionTypeCode: 'EARLY',
            departmentCode: 'CSE',
            admissionTypeName: '학생부종합전형',
            departmentName: '컴퓨터공학과',
            applicationNumber: '2027-A-ABCDEF',
            requestedAt: '2026-09-11T08:59:40Z',
            paymentApprovedAt: null,
            finalizedAt: '2026-09-11T08:59:42Z',
        });
        const { ok, errors } = validate('ApplicationFinalizedData', data);
        strict_1.default.ok(ok, errors);
        strict_1.default.equal(data.admissionTypeName, '학생부종합전형');
        strict_1.default.equal(data.departmentName, '컴퓨터공학과');
    });
    (0, node_test_1.it)('취소 이벤트 — 사유 문장 없이 분류만', () => {
        const data = (0, central_events_1.cancelledEventData)({ applicationId: APP, cancelledAt: '2026-09-23T00:14:52.814Z' });
        const { ok, errors } = validate('ApplicationCancelledData', data);
        strict_1.default.ok(ok, errors);
        strict_1.default.equal(data.reasonCode, 'APPLICANT_REQUEST');
    });
    (0, node_test_1.it)('두 이벤트는 같은 불투명 ID 를 쓰고, 대학 내부 UUID 는 어디에도 없다', () => {
        const finalized = (0, central_events_1.finalizedEventData)({
            applicationId: APP, admissionYear: 2027, admissionTypeCode: 'EARLY', departmentCode: 'CSE',
            applicationNumber: 'N', requestedAt: 'x', paymentApprovedAt: null, finalizedAt: 'y',
        });
        const cancelled = (0, central_events_1.cancelledEventData)({ applicationId: APP, cancelledAt: 'z' });
        strict_1.default.equal(finalized.applicationId, cancelled.applicationId);
        strict_1.default.equal(finalized.applicationId, (0, central_events_1.centralApplicationId)(APP));
        strict_1.default.equal(JSON.stringify([finalized, cancelled]).includes(APP), false);
    });
    (0, node_test_1.it)('스키마 밖 필드를 더하면 거절된다 — 검증이 실제로 막는지', () => {
        const data = { ...(0, central_events_1.cancelledEventData)({ applicationId: APP, cancelledAt: '2026-09-23T00:14:52Z' }), refundRequired: true };
        strict_1.default.equal(validate('ApplicationCancelledData', data).ok, false);
    });
});
//# sourceMappingURL=central-events.test.js.map