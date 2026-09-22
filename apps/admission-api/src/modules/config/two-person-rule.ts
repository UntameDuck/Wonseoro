import { ProblemException } from '../../common/problem/problem.exception';

/**
 * 2인 승인 규칙 — 기술설계서 v1.1 §A14, §01 E
 *
 * **"단독 운영자 1명으로 마감시간 변경 불가"** 가 핵심 인수기준이다.
 *
 * 2026년 장애에서 마감 연장 결정이 기술팀에 전가된 것이 문제가 됐다. (§B17)
 * 그래서 중대 설정은 사람 두 명이 승인해야 하고, 그중 누구도
 * 자기가 만든 것을 혼자 통과시킬 수 없다.
 *
 * ⚠️ `deadline_policy` 는 DB 가 `CHECK (approved_by_1 <> approved_by_2)` 로 막는다.
 * `config_version` 은 **DB 제약이 없어** 여기서만 막힌다. (불일치 대장 D-21)
 * 코드는 우회 가능하고 DB 는 아니다. DDL 에 제약을 넣어야 같은 수준이 된다.
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
export function addApproval(state: ApprovalState, approver: string): ApprovalResult {
  const who = approver.trim();
  if (!who) {
    throw ProblemException.validationFailed('승인자를 식별할 수 없습니다.');
  }

  if (who === state.createdBy) {
    throw ProblemException.forbidden(
      '작성자는 자신이 만든 변경을 승인할 수 없습니다. 다른 담당자의 승인이 필요합니다.',
    );
  }

  if (state.approvedBy1 === who || state.approvedBy2 === who) {
    throw ProblemException.forbidden(
      '이미 승인하셨습니다. 서로 다른 두 명의 승인이 필요합니다.',
    );
  }

  if (!state.approvedBy1) {
    return { approvedBy1: who, approvedBy2: null, complete: false };
  }
  if (!state.approvedBy2) {
    return { approvedBy1: state.approvedBy1, approvedBy2: who, complete: true };
  }

  throw ProblemException.validationFailed('이미 승인이 완료되었습니다.');
}

/** 활성화 직전에 다시 확인한다. 승인 없이 ACTIVE 가 되는 경로를 만들지 않는다. */
export function assertApproved(state: ApprovalState): void {
  if (!state.approvedBy1 || !state.approvedBy2) {
    throw ProblemException.forbidden(
      '서로 다른 두 명의 승인이 필요합니다. 활성화할 수 없습니다.',
    );
  }
  if (state.approvedBy1 === state.approvedBy2) {
    // DB CHECK 가 없는 config_version 에서 이 경로가 실제로 열려 있다. (D-21)
    throw ProblemException.forbidden('서로 다른 두 명이 승인해야 합니다.');
  }
}

/**
 * 활성화 예약 시각 검증. (§A14 "활성화 예약시간")
 * 과거 시각으로 예약하면 승인 절차를 우회해 즉시 적용하는 셈이 된다.
 */
export function assertActivationTime(activateAt: Date | null, now = new Date()): void {
  if (!activateAt) return;
  if (activateAt.getTime() < now.getTime() - 60_000) {
    throw ProblemException.validationFailed(
      '활성화 예약 시각을 과거로 지정할 수 없습니다.',
    );
  }
}
