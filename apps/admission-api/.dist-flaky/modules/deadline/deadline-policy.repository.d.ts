import { DeadlineMode, DeadlinePolicy, DeadlinePolicyStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { ActivationRecorder, ActivationView } from '../activation/activation-recorder';
import { DeadlinePolicyPort } from './deadline-policy.port';
/**
 * 연장 초안에 함께 묶이는 사실. 정책 해시에 들어가므로 승인 뒤에 바꿀 수 없다.
 * (v1.1 §B17 — 누가 언제 **왜** 연장했는지)
 */
export interface ExtensionFacts {
    kind: 'EXTENSION';
    /** 어느 정책을 연장하는가. 활성화할 때 그 정책이 여전히 적용 중이어야 한다. */
    extendsVersion: string;
    extendsDeadlineAt: string;
    reason: string;
    /** 입학처 결정 문서번호. 기술팀은 연장을 결정하지 않는다. */
    decisionRef: string;
}
/**
 * Deadline Policy Engine — 기술설계서 v1.1 §A2·§A14 (T-M3-01)
 *
 * M1 의 환경변수 구현을 대체한다. 이제 마감 판정의 근거는
 * **DB 에 승인·활성화 기록이 남은 정책 버전**이다.
 *
 * 설계 원칙
 *   1. 활성화된 정책이 없으면 **마감을 판정하지 않는다.** 추측하지 않는다
 *   2. 정책은 불변이다. 바꾸려면 새 버전을 만들고 다시 승인받는다
 *   3. 활성화 이력이 남는다. "누가 언제 마감을 바꿨는가"에 답할 수 있어야 한다
 *   4. 2인 승인 없이는 활성화되지 않는다. DB CHECK 가 함께 막는다
 *   5. 활성화는 **서명된 기록**으로 남는다. 누가 언제 왜 적용했는지 (T-M3-15)
 *   6. 한 번 적용된 정책은 다시 활성화하지 않는다. 마감은 새 버전으로만 앞으로 간다
 */
export declare class DeadlinePolicyRepository extends DeadlinePolicyPort {
    private readonly db;
    private readonly activations;
    private readonly logger;
    constructor(db: Db, activations: ActivationRecorder);
    /**
     * 현재 적용되는 정책.
     *
     * 활성화 시각이 이미 지난 것 중 가장 최근 것을 쓴다.
     * 예약 활성화(미래 시각)는 아직 적용되지 않는다. (§A14)
     */
    current(admissionCycleId: string): Promise<DeadlinePolicy>;
    /** 정책 초안 생성. 이 시점에는 아직 아무 효력이 없다. */
    createDraft(input: {
        cycleId: string;
        version: string;
        mode: DeadlineMode;
        deadlineAt: string;
        createdBy: string;
        extension?: ExtensionFacts;
    }): Promise<{
        policyId: string;
        policyHash: string;
    }>;
    /**
     * 마감 연장 초안 — v1.1 §B17 (T-M3-14)
     *
     * **연장은 지금 적용 중인 정책을 기준으로만 만든다.**
     * 방식(mode)은 그대로 물려받는다. 연장 절차로 판정 기준까지 바꾸면, 승인자는
     * "마감이 늦춰진다" 고만 알고 승인하게 된다.
     *
     * **사유와 입학처 결정 문서번호가 필수다.** 이 시스템은 연장을 결정하지 않는다.
     * 입학처가 내린 결정을 기록하고 집행할 뿐이다. 결정 근거 없이 연장이 만들어지면
     * 기술팀이 마감을 바꾼 것과 구별되지 않는다.
     *
     * 그 뒤는 일반 정책과 같다. 작성자가 아닌 두 명이 승인해야 활성화된다.
     * 마감 임박 잠금(Freeze)에는 걸리지 않는다 — 장애로 마감을 연장해야 하는 순간이
     * 바로 마감 직전이다.
     */
    createExtension(input: {
        cycleId: string;
        deadlineAt: string;
        reason: string;
        decisionRef: string;
        createdBy: string;
    }): Promise<{
        policyId: string;
        policyHash: string;
        version: string;
        extendsVersion: string;
    }>;
    approve(policyId: string, approver: string): Promise<{
        complete: boolean;
    }>;
    /**
     * 활성화. 이 시점부터 마감 판정에 쓰인다. (D-22 — 계약에 없던 경로)
     * 예약 시각을 주면 그때부터 적용된다.
     */
    activate(policyId: string, activateAt: Date | null, operatorId: string): Promise<{
        activatedAt: string;
        activation: ActivationView;
    }>;
    /** 서명된 활성화 이력. 각 기록의 서명을 다시 검증해 돌려준다. */
    activationHistory(cycleId: string): Promise<ActivationView[]>;
    /**
     * 지금 효력이 있는 정책. `excludeId` 는 활성화 중인 자기 자신을 빼려고 쓴다.
     * 활성화 트랜잭션 안에서 부르므로 client 를 받는다.
     */
    private effective;
    /** 정책 이력. "누가 언제 마감을 바꿨는가"에 답한다. */
    history(cycleId: string): Promise<Array<{
        policyId: string;
        version: string;
        mode: string;
        deadlineAt: string;
        status: DeadlinePolicyStatus;
        approvedBy: string[];
        activatedAt: string | null;
        policyHash: string;
        /** 작성자. 화면이 "본인은 승인할 수 없음" 을 미리 보여주려고 싣는다. 막는 것은 서버·DB 다. */
        createdBy: string;
        createdAt: string;
        /** 연장이면 사유·결정번호·기준 정책. */
        extension: ExtensionFacts | null;
    }>>;
    private loadApprovalState;
    private toPolicy;
    /** 개발 전용. ALLOW_ENV_DEADLINE_POLICY=true 일 때만. */
    private envPolicy;
}
