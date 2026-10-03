import { RetentionCategory, RetentionCategoryCode, RetentionProblem } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
export type RetentionStatus = 
/** 보존정책에 항목이 없다. 파기 대상이 아니다. */
'UNSET'
/** 보존기간이 아직 남았다. */
 | 'RETAINED'
/** 보존기간이 지났다. 파기 대상이다. */
 | 'DUE'
/** 기간이 지났지만 감사 체인 안에 있어 지울 수 없다. WORM 이관 뒤에 다룬다. */
 | 'DUE_BUT_CHAINED'
/** 보존기간을 정할 수 없는 기록. */
 | 'IMMUTABLE';
export interface RetentionPlanItem {
    code: RetentionCategoryCode;
    label: string;
    floor: RetentionCategory['floor'];
    purge: RetentionCategory['purge'];
    days: number | null;
    dueAt: string | null;
    status: RetentionStatus;
    /** DUE 일 때만 센다. 보존 중인 데이터의 양은 여기서 알 필요가 없다. */
    affected: number | null;
}
/**
 * 파기 계획 — v1.1 §A15 (T-M3-10)
 *
 * **계획만 보여준다. 지우지 않는다.**
 * 파기는 되돌릴 수 없다. 지우는 코드는 WORM 이관(M5)과 함께, 그리고 이 계획을
 * 사람이 읽고 승인하는 절차와 함께 붙인다. 계획 없이 지우는 코드부터 만들면
 * 보존정책의 오타 하나가 한 해 입시 기록을 지운다.
 *
 * 원서 "파기" 는 행 삭제가 아니라 **내용 제거**다. 감사 체인이 원서 행을 참조하고
 * (audit_event.application_id, CASCADE 없음), 원서를 지우면 동의 기록이 함께
 * 지워진다(consent_record ON DELETE CASCADE). 행을 지우는 순간 증적이 깨진다. (D-38)
 */
export declare class RetentionService {
    private readonly db;
    constructor(db: Db);
    plan(cycleId: string): Promise<{
        cycleId: string;
        cycleClosesAt: string;
        configVersion: string | null;
        configured: boolean;
        /** 적용 중인 정책이 지금 기준에 맞는가. 법정 기준이 올라가면 맞지 않을 수 있다. */
        problems: RetentionProblem[];
        items: RetentionPlanItem[];
        executes: false;
        generatedAt: string;
    }>;
    private countInCycle;
    private countEvents;
}
