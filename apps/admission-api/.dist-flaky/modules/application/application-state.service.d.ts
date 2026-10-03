import type { PoolClient } from 'pg';
import { ApplicationStatus } from '@wonseoro/contracts';
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
export declare function transitionApplication(client: PoolClient, applicationId: string, from: readonly ApplicationStatus[], to: ApplicationStatus): Promise<boolean>;
/**
 * Application 상태머신 — 기술설계서 v1.0 §5.6
 *
 * 전이 규칙의 단일 출처는 @wonseoro/contracts 의 APPLICATION_TRANSITIONS 다.
 * 서비스 코드에 전이 조건을 중복해서 쓰지 않는다. (v1.1 §A5 표준 붕괴 방지)
 */
export declare class ApplicationStateService {
    /** 전이 가능 여부만 확인한다. 던지지 않는다. */
    can(from: ApplicationStatus, to: ApplicationStatus): boolean;
    /** 허용되지 않은 전이면 409 를 던진다. */
    assertCan(from: ApplicationStatus, to: ApplicationStatus): void;
    /**
     * 업무필드 수정이 허용되는 상태인지.
     * 결제를 시작하면(PAYMENT_PENDING) 더 고칠 수 없다 — 결제가 곧 제출이라(D-42) 결제 전 확인을
     * 통과한 내용 그대로 접수돼야 한다. 결제 뒤에 필수 항목을 지우면 돈만 받고 접수가 거절된다.
     */
    isEditable(status: ApplicationStatus): boolean;
    isTerminal(status: ApplicationStatus): boolean;
    /** 디버깅·문서화용. 현재 상태에서 갈 수 있는 곳. */
    nextStates(from: ApplicationStatus): readonly ApplicationStatus[];
}
