"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const two_person_rule_1 = require("./two-person-rule");
const status = (fn) => {
    try {
        fn();
        return undefined;
    }
    catch (err) {
        return err.problem?.status;
    }
};
(0, node_test_1.describe)('2인 승인 규칙 (v1.1 §A14 / §01 E)', () => {
    const fresh = { createdBy: 'admin1@univ-a', approvedBy1: null, approvedBy2: null };
    (0, node_test_1.it)('첫 승인은 미완료다', () => {
        const r = (0, two_person_rule_1.addApproval)(fresh, 'admin2@univ-a');
        strict_1.default.equal(r.approvedBy1, 'admin2@univ-a');
        strict_1.default.equal(r.complete, false, '한 명으로 완료되면 단독 승인이 가능해진다');
    });
    (0, node_test_1.it)('서로 다른 두 명이 승인하면 완료된다', () => {
        const first = (0, two_person_rule_1.addApproval)(fresh, 'admin2@univ-a');
        const second = (0, two_person_rule_1.addApproval)({ ...fresh, approvedBy1: first.approvedBy1 }, 'admin3@univ-a');
        strict_1.default.equal(second.complete, true);
        strict_1.default.notEqual(second.approvedBy1, second.approvedBy2);
    });
    (0, node_test_1.it)('작성자는 자기 변경을 승인할 수 없다', () => {
        // 이걸 허용하면 한 사람이 만들고 한 사람이 통과시키는 셈이 된다.
        strict_1.default.equal(status(() => (0, two_person_rule_1.addApproval)(fresh, 'admin1@univ-a')), 403);
    });
    (0, node_test_1.it)('같은 사람이 두 번 승인할 수 없다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.addApproval)({ ...fresh, approvedBy1: 'admin2@univ-a' }, 'admin2@univ-a')), 403);
    });
    (0, node_test_1.it)('승인이 끝난 뒤 추가 승인은 거부한다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.addApproval)({ ...fresh, approvedBy1: 'admin2@univ-a', approvedBy2: 'admin3@univ-a' }, 'admin4@univ-a')), 400);
    });
    (0, node_test_1.it)('공백만 있는 승인자를 거부한다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.addApproval)(fresh, '   ')), 400);
    });
});
(0, node_test_1.describe)('활성화 전 확인', () => {
    (0, node_test_1.it)('승인자가 한 명이면 활성화할 수 없다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.assertApproved)({
            createdBy: 'a',
            approvedBy1: 'b',
            approvedBy2: null,
        })), 403);
    });
    (0, node_test_1.it)('승인자가 없으면 활성화할 수 없다 — config_version 의 실제 위험 (D-21)', () => {
        // DDL 에 제약이 없어 DB 는 이 상태로 ACTIVE 를 허용한다.
        // 여기서 막지 않으면 승인 0명으로 마감시각이 바뀐다.
        strict_1.default.equal(status(() => (0, two_person_rule_1.assertApproved)({ createdBy: 'a', approvedBy1: null, approvedBy2: null })), 403);
    });
    (0, node_test_1.it)('같은 사람이 두 칸을 채웠으면 거부한다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.assertApproved)({ createdBy: 'a', approvedBy1: 'b', approvedBy2: 'b' })), 403);
    });
    (0, node_test_1.it)('서로 다른 두 명이면 통과한다', () => {
        strict_1.default.doesNotThrow(() => (0, two_person_rule_1.assertApproved)({ createdBy: 'a', approvedBy1: 'b', approvedBy2: 'c' }));
    });
});
(0, node_test_1.describe)('활성화 예약 시각 (v1.1 §A14)', () => {
    const now = new Date('2026-09-23T00:00:00.000Z');
    (0, node_test_1.it)('미래 예약은 허용한다', () => {
        strict_1.default.doesNotThrow(() => (0, two_person_rule_1.assertActivationTime)(new Date('2026-09-24T00:00:00.000Z'), now));
    });
    (0, node_test_1.it)('예약 없이 즉시 활성화는 허용한다', () => {
        strict_1.default.doesNotThrow(() => (0, two_person_rule_1.assertActivationTime)(null, now));
    });
    (0, node_test_1.it)('과거 시각 예약은 거부한다 — 승인 절차를 소급 우회하는 셈이다', () => {
        strict_1.default.equal(status(() => (0, two_person_rule_1.assertActivationTime)(new Date('2026-09-22T00:00:00.000Z'), now)), 400);
    });
    (0, node_test_1.it)('시계 오차 범위(1분)는 허용한다', () => {
        strict_1.default.doesNotThrow(() => (0, two_person_rule_1.assertActivationTime)(new Date('2026-09-22T23:59:30.000Z'), now));
    });
});
//# sourceMappingURL=two-person-rule.test.js.map