"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addApproval = addApproval;
exports.assertApproved = assertApproved;
exports.assertActivationTime = assertActivationTime;
const problem_exception_1 = require("../../common/problem/problem.exception");
/**
 * 승인을 한 건 추가한다.
 *
 * 규칙
 *   1. 작성자는 승인자가 될 수 없다 — 자기 변경을 혼자 통과시키지 못한다
 *   2. 같은 사람이 두 번 승인할 수 없다
 *   3. 두 명이 차면 완료다
 */
function addApproval(state, approver) {
    const who = approver.trim();
    if (!who) {
        throw problem_exception_1.ProblemException.validationFailed('승인자를 식별할 수 없습니다.');
    }
    if (who === state.createdBy) {
        throw problem_exception_1.ProblemException.forbidden('작성자는 자신이 만든 변경을 승인할 수 없습니다. 다른 담당자의 승인이 필요합니다.');
    }
    if (state.approvedBy1 === who || state.approvedBy2 === who) {
        throw problem_exception_1.ProblemException.forbidden('이미 승인하셨습니다. 서로 다른 두 명의 승인이 필요합니다.');
    }
    if (!state.approvedBy1) {
        return { approvedBy1: who, approvedBy2: null, complete: false };
    }
    if (!state.approvedBy2) {
        return { approvedBy1: state.approvedBy1, approvedBy2: who, complete: true };
    }
    throw problem_exception_1.ProblemException.validationFailed('이미 승인이 완료되었습니다.');
}
/** 활성화 직전에 다시 확인한다. 승인 없이 ACTIVE 가 되는 경로를 만들지 않는다. */
function assertApproved(state) {
    if (!state.approvedBy1 || !state.approvedBy2) {
        throw problem_exception_1.ProblemException.forbidden('서로 다른 두 명의 승인이 필요합니다. 활성화할 수 없습니다.');
    }
    if (state.approvedBy1 === state.approvedBy2) {
        // DB CHECK 가 없는 config_version 에서 이 경로가 실제로 열려 있다. (D-21)
        throw problem_exception_1.ProblemException.forbidden('서로 다른 두 명이 승인해야 합니다.');
    }
}
/**
 * 활성화 예약 시각 검증. (§A14 "활성화 예약시간")
 * 과거 시각으로 예약하면 승인 절차를 우회해 즉시 적용하는 셈이 된다.
 */
function assertActivationTime(activateAt, now = new Date()) {
    if (!activateAt)
        return;
    if (activateAt.getTime() < now.getTime() - 60_000) {
        throw problem_exception_1.ProblemException.validationFailed('활성화 예약 시각을 과거로 지정할 수 없습니다.');
    }
}
//# sourceMappingURL=two-person-rule.js.map