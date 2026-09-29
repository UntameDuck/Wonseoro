import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { cancelledEventData, centralApplicationId, finalizedEventData } from './central-events';

/**
 * 중앙 이벤트 본문 = CloudEvents 스키마 (D-50).
 *
 * 스키마는 노션 §04 첨부와 바이트가 같은 canonical 계약이다. 전에는 취소 이벤트가 applicationId·reasonCode·
 * integrityHash 없이 나가 중앙이 전부 400 으로 거절했고(로컬 DB 에 DEAD 6건), 접수 이벤트는 스키마에 없는
 * universityId·submittedAt 을 실었다. 본문을 만드는 함수를 스키마로 직접 검증한다.
 */
const schema = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../../packages/contracts/events/k-admission-cloudevents.schema.json'),
  'utf8',
));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);
const validate = (def: string, data: unknown) => {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${def}`)!;
  const ok = check(data);
  return { ok, errors: JSON.stringify(check.errors) };
};

const APP = '84f21d99-750b-4b4d-a43c-f8acb30672bd';

describe('중앙 이벤트 본문은 CloudEvents 스키마를 따른다 (D-50)', () => {
  it('접수 이벤트', () => {
    const data = finalizedEventData({
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
    assert.ok(ok, errors);
  });

  it('취소 이벤트 — 사유 문장 없이 분류만', () => {
    const data = cancelledEventData({ applicationId: APP, cancelledAt: '2026-09-23T00:14:52.814Z' });
    const { ok, errors } = validate('ApplicationCancelledData', data);
    assert.ok(ok, errors);
    assert.equal(data.reasonCode, 'APPLICANT_REQUEST');
  });

  it('두 이벤트는 같은 불투명 ID 를 쓰고, 대학 내부 UUID 는 어디에도 없다', () => {
    const finalized = finalizedEventData({
      applicationId: APP, admissionYear: 2027, admissionTypeCode: 'EARLY', departmentCode: 'CSE',
      applicationNumber: 'N', requestedAt: 'x', paymentApprovedAt: null, finalizedAt: 'y',
    });
    const cancelled = cancelledEventData({ applicationId: APP, cancelledAt: 'z' });
    assert.equal(finalized.applicationId, cancelled.applicationId);
    assert.equal(finalized.applicationId, centralApplicationId(APP));
    assert.equal(JSON.stringify([finalized, cancelled]).includes(APP), false);
  });

  it('스키마 밖 필드를 더하면 거절된다 — 검증이 실제로 막는지', () => {
    const data = { ...cancelledEventData({ applicationId: APP, cancelledAt: '2026-09-23T00:14:52Z' }), refundRequired: true };
    assert.equal(validate('ApplicationCancelledData', data).ok, false);
  });
});
