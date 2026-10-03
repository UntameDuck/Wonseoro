/**
 * 2인 승인 규칙 — 기술설계서 v1.1 §A14, §01 E
 *
 * **"단독 운영자 1명으로 마감시간 변경 불가"** 가 핵심 인수기준이다.
 *
 * 2026년 장애에서 마감 연장 결정이 기술팀에 전가된 것이 문제가 됐다. (§B17)
 * 그래서 중대 설정은 사람 두 명이 승인해야 하고, 그중 누구도
 * 자기가 만든 것을 혼자 통과시킬 수 없다.
 *
 * 코드는 우회 가능하고 DB 는 아니다. 그래서 같은 규칙을 DB 제약으로도 건다 —
 * `config_version` 은 0002 (D-21), `deadline_policy` 는 0006 (D-23):
 * 서로 다른 두 승인자 · 작성자 자기승인 금지 · 승인 없이 활성화 금지.
 *
 * 적용 대상 (§A14)
 *   마감시각 · 전형료 · 모집단위 · 지원자격 · PG 설정
 */
export interface ApprovalState {
    createdBy: string;
    approvedBy1: string | null;
    approvedBy2: string | null;
}
export interface ApprovalResult {
    approvedBy1: string;
    approvedBy2: string | null;
    /** 두 명이 모두 승인했는가. */
    complete: boolean;
}
/**
 * 승인을 한 건 추가한다.
 *
 * 규칙
 *   1. 작성자는 승인자가 될 수 없다 — 자기 변경을 혼자 통과시키지 못한다
 *   2. 같은 사람이 두 번 승인할 수 없다
 *   3. 두 명이 차면 완료다
 */
export declare function addApproval(state: ApprovalState, approver: string): ApprovalResult;
/** 활성화 직전에 다시 확인한다. 승인 없이 ACTIVE 가 되는 경로를 만들지 않는다. */
export declare function assertApproved(state: ApprovalState): void;
/**
 * 활성화 예약 시각 검증. (§A14 "활성화 예약시간")
 * 과거 시각으로 예약하면 승인 절차를 우회해 즉시 적용하는 셈이 된다.
 */
export declare function assertActivationTime(activateAt: Date | null, now?: Date): void;
