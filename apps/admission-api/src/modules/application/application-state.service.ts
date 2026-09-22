import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  APPLICATION_TRANSITIONS,
  canTransition,
  isTerminal,
} from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';

/**
 * 조건부 전이 명세.
 *
 * DB 반영은 반드시 이 형태의 조건부 UPDATE 로 한다.
 *   UPDATE application
 *      SET status = :to, version = version + 1
 *    WHERE application_id = :id
 *      AND status = :expectedStatus
 *      AND version = :expectedVersion
 *
 * 읽고-검사하고-쓰는 방식은 마감 피크 경합에서 깨진다. (v1.1 §B3)
 * affectedRows 가 0이면 다른 요청이 먼저 바꾼 것이므로 409 로 응답한다.
 */
export interface ConditionalTransition {
  applicationId: string;
  expectedStatus: ApplicationStatus;
  expectedVersion: bigint;
  nextStatus: ApplicationStatus;
}

/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 *
 * 전이 규칙의 단일 출처는 @wonseoro/contracts 의 APPLICATION_TRANSITIONS 다.
 * 서비스 코드에 전이 조건을 중복해서 쓰지 않는다. (v1.1 §A5 표준 붕괴 방지)
 */
@Injectable()
export class ApplicationStateService {
  /** 전이 가능 여부만 확인한다. 던지지 않는다. */
  can(from: ApplicationStatus, to: ApplicationStatus): boolean {
    return canTransition(from, to);
  }

  /** 허용되지 않은 전이면 409 를 던진다. */
  assertCan(from: ApplicationStatus, to: ApplicationStatus): void {
    if (from === 'FINALIZED') {
      // 접수 완료는 되돌릴 수 없다. 일반 사용자 API 에 수정 경로를 만들지 않는다.
      throw new ProblemException({
        type: 'https://wonseoro.kr/problems/already-finalized',
        title: '이미 접수가 완료된 원서입니다',
        status: 409,
        detail: '접수 완료 후에는 원서를 변경할 수 없습니다.',
      });
    }
    if (!this.can(from, to)) {
      throw ProblemException.illegalTransition(from, to);
    }
  }

  /**
   * 조건부 전이 명세를 만든다. 실제 UPDATE 는 저장소 어댑터가 수행한다.
   * ⚠️ Postgres 어댑터는 DDL 배치(T-M1-01) 후 구현한다.
   */
  plan(
    applicationId: string,
    from: ApplicationStatus,
    fromVersion: bigint,
    to: ApplicationStatus,
  ): ConditionalTransition {
    this.assertCan(from, to);
    return {
      applicationId,
      expectedStatus: from,
      expectedVersion: fromVersion,
      nextStatus: to,
    };
  }

  /** 조건부 UPDATE 결과 해석. 0건이면 다른 요청이 먼저 바꾼 것이다. */
  assertApplied(affectedRows: number, transition: ConditionalTransition): void {
    if (affectedRows === 0) {
      throw ProblemException.versionConflict(
        `원서 상태가 이미 변경되었습니다. 최신 상태를 다시 조회해 주십시오. ` +
          `(기대: ${transition.expectedStatus} v${transition.expectedVersion})`,
      );
    }
  }

  /** 업무필드 수정이 허용되는 상태인지. */
  isEditable(status: ApplicationStatus): boolean {
    return status === 'DRAFT' || status === 'READY';
  }

  isTerminal(status: ApplicationStatus): boolean {
    return isTerminal(status);
  }

  /** 디버깅·문서화용. 현재 상태에서 갈 수 있는 곳. */
  nextStates(from: ApplicationStatus): readonly ApplicationStatus[] {
    return APPLICATION_TRANSITIONS[from];
  }
}
