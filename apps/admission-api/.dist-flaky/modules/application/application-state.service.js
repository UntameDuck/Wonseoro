"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationStateService = void 0;
exports.transitionApplication = transitionApplication;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@wonseoro/contracts");
const problem_exception_1 = require("../../common/problem/problem.exception");
/**
 * 조건부 전이 — 원서 상태를 DB 에 반영하는 길. (v1.1 §B3)
 *
 *   UPDATE application
 *      SET status = :to, version = version + 1
 *    WHERE id = :id AND status = ANY(:from)
 *
 * 읽고-검사하고-쓰는 방식은 마감 피크 경합에서 깨진다. `from` 중 전이 표가 허용하는 상태만 남기고,
 * 지금 상태가 그중 하나일 때만 옮긴다. 옮긴 행이 없으면 false — 다른 요청이 먼저 바꾼 것이다.
 * 전이 표에 없는 전이를 부르면 코드 결함이라 바로 던진다(조용히 무시하지 않는다).
 */
async function transitionApplication(client, applicationId, from, to) {
    const allowed = from.filter((f) => (0, contracts_1.canTransition)(f, to));
    if (allowed.length === 0) {
        throw new Error(`전이 표에 없는 원서 상태 전이: ${from.join('|')} -> ${to}`);
    }
    const moved = await client.query(`UPDATE application
        SET status = $3, version = version + 1, updated_at = now()
      WHERE id = $1 AND status = ANY($2::text[])`, [applicationId, allowed, to]);
    return (moved.rowCount ?? 0) > 0;
}
/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 *
 * 전이 규칙의 단일 출처는 @wonseoro/contracts 의 APPLICATION_TRANSITIONS 다.
 * 서비스 코드에 전이 조건을 중복해서 쓰지 않는다. (v1.1 §A5 표준 붕괴 방지)
 */
let ApplicationStateService = class ApplicationStateService {
    /** 전이 가능 여부만 확인한다. 던지지 않는다. */
    can(from, to) {
        return (0, contracts_1.canTransition)(from, to);
    }
    /** 허용되지 않은 전이면 409 를 던진다. */
    assertCan(from, to) {
        if (from === 'FINALIZED') {
            // 접수 완료는 되돌릴 수 없다. 일반 사용자 API 에 수정 경로를 만들지 않는다.
            throw problem_exception_1.ProblemException.alreadyFinalized();
        }
        if (!this.can(from, to)) {
            throw problem_exception_1.ProblemException.illegalTransition(from, to);
        }
    }
    /**
     * 업무필드 수정이 허용되는 상태인지.
     * 결제를 시작하면(PAYMENT_PENDING) 더 고칠 수 없다 — 결제가 곧 제출이라(D-42) 결제 전 확인을
     * 통과한 내용 그대로 접수돼야 한다. 결제 뒤에 필수 항목을 지우면 돈만 받고 접수가 거절된다.
     */
    isEditable(status) {
        return status === 'DRAFT' || status === 'READY';
    }
    isTerminal(status) {
        return (0, contracts_1.isTerminal)(status);
    }
    /** 디버깅·문서화용. 현재 상태에서 갈 수 있는 곳. */
    nextStates(from) {
        return contracts_1.APPLICATION_TRANSITIONS[from];
    }
};
exports.ApplicationStateService = ApplicationStateService;
exports.ApplicationStateService = ApplicationStateService = __decorate([
    (0, common_1.Injectable)()
], ApplicationStateService);
//# sourceMappingURL=application-state.service.js.map