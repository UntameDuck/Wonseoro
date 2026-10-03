import type { Queryable } from '../../common/db/queryable';
/**
 * 진행 중 원서와의 호환 시험 — 기술설계서 v1.1 §01 A5 "Compatibility Test" (T-M6-02, D-77)
 *
 * Config Linter 는 설정 **자체**가 맞는지 본다(컴파일·항목 이름·서류 코드). 그러나 새 설정이 **이미 쓰고 있는 원서**와
 * 맞는지는 모른다 — 최대 글자 수를 줄이거나 선택지를 빼거나 형식을 바꾸면 저장된 값이 새 양식에 어긋나고,
 * 필수 항목을 더하면 이미 검증·결제를 마친 원서가 접수 확정에서 막힌다(마감 직전이면 지원자가 고칠 시간도 없다).
 *
 * 적용(activate) 직전에 이 주기의 진행 중 원서를 새 양식으로 검사한다. 하나라도 깨지면 적용하지 않는다.
 *   - 작성 중(DRAFT): 저장된 값만 본다 — 아직 안 쓴 필수 항목은 지원자가 채울 수 있다
 *   - 검증 끝·결제 중·결제 완료(READY·PAYMENT_PENDING·PAID): 필수까지 본다 — 이 원서들은 다시 고칠 수 없거나(결제 뒤) 다시 검증을 거쳐야 한다
 * 값은 원서마다 풀어 검사하고 남기지 않는다(필드 암호화, D-70). 결과에는 원서 ID·항목 경로만 담는다.
 */
export interface CompatProblem {
    applicationId: string;
    status: string;
    admissionTypeCode: string;
    problems: string[];
}
export interface CompatResult {
    checked: number;
    broken: CompatProblem[];
}
export declare function checkInFlightCompatibility(db: Queryable, cycleId: string, config: unknown, limit?: number): Promise<CompatResult>;
/** 승인 화면·거절 문구용 요약 — 항목 경로와 건수만 */
export declare function describeCompat(r: CompatResult): string;
