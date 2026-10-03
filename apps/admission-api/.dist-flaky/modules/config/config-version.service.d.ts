import { Db } from '@wonseoro/server-kit';
import { ActivationRecorder, ActivationView } from '../activation/activation-recorder';
import { DeadlineService } from '../deadline/deadline.service';
import { ConfigDiff } from './config-diff';
export interface ConfigVersionRow {
    id: string;
    version: string;
    status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
    configHash: string;
    createdBy: string;
    approvedBy: string[];
    activatedAt: string | null;
}
/**
 * Configuration Governance — 기술설계서 v1.1 §A14·§C5 (T-M3-02)
 *
 * 마감시각·전형료·모집단위·지원자격·PG 설정이 전부 여기 들어간다.
 * **운영자 한 명이 이것들을 혼자 바꿀 수 없어야 한다.** (§01 E)
 *
 * 수명주기
 *   DRAFT → (서로 다른 2인 승인) → APPROVED → (활성화) → ACTIVE
 *   기존 ACTIVE 는 RETIRED 로 물러난다
 *
 * 2인 승인만으로는 부족하다
 *   빈 Config 를 절차대로 활성화해 모든 양식이 사라진 적이 있다. 승인 두 명,
 *   활성화 성공 — 절차는 정상이었다. 승인자가 **무엇이 바뀌는지** 보지 못하면
 *   사람이 둘이어도 사고를 막지 못한다. 그래서 승인에 Diff 확인을 묶는다.
 *
 * 되돌리기
 *   Rollback 은 새 버전을 만들지 않는다. **전에 ACTIVE 였던 그 버전을 다시 올린다.**
 *   그 행에는 이미 두 명의 실제 승인이 기록돼 있다. 새로 만들면 승인자를 지어내야 하고,
 *   그건 D-21 로 막은 것을 코드로 우회하는 일이다.
 *
 * Freeze
 *   마감이 임박하면 설정을 바꾸지 않는다. 다만 **되돌리기는 막지 않는다** —
 *   Freeze 는 새 변경을 멈추는 장치이지 복구를 멈추는 장치가 아니다.
 *
 * 서명된 활성화 기록 (T-M3-15)
 *   활성화·되돌리기마다 누가·언제·왜 를 서명해 남긴다. 되돌리기는 같은 행의
 *   activated_at 을 덮어쓰므로, 이 기록이 없으면 두 번째 적용이 첫 번째 적용의
 *   흔적을 지운다.
 */
export declare class ConfigVersionService {
    private readonly db;
    private readonly deadline;
    private readonly activations;
    private readonly logger;
    constructor(db: Db, deadline: DeadlineService, activations: ActivationRecorder);
    createDraft(input: {
        cycleId: string;
        version: string;
        config: Record<string, unknown>;
        createdBy: string;
    }): Promise<ConfigVersionRow>;
    /**
     * 승인. **본 Diff 의 digest 를 함께 받는다.**
     *
     * 승인은 "이 설정 ID 에 동의한다" 가 아니라 "이 변경에 동의한다" 는 뜻이다.
     * 승인자가 화면을 본 뒤에 초안이나 기준이 바뀌면 같은 승인이 다른 의미가 된다.
     * digest 가 어긋나면 다시 보라고 돌려보낸다.
     */
    approve(configId: string, approver: string, acknowledgedDiffDigest: string): Promise<ConfigVersionRow>;
    /**
     * 활성화. 기존 ACTIVE 를 RETIRED 로 내리고 이것을 올린다.
     * **한 트랜잭션에서 한다.** 중간에 끊기면 활성 Config 가 0개이거나 2개가 된다.
     */
    activate(configId: string, activateAt: Date | null, operatorId: string): Promise<ConfigVersionRow & {
        activation: ActivationView;
    }>;
    /**
     * 이 초안이 현재 활성 설정과 무엇이 다른가.
     * 승인 화면이 그대로 그려서 보여준다.
     */
    diff(configId: string): Promise<ConfigDiff>;
    /** 이 모집의 전형 코드 → 이름. 설정 검사가 모르는 전형 코드를 찾고, Diff 요약이 전형 이름을 쓴다. */
    private types;
    /** 이 모집의 전형 코드. */
    private typeCodes;
    /**
     * 되돌리기.
     *
     * **새 버전을 만들지 않는다.** 전에 ACTIVE 였던 그 버전을 다시 올린다.
     * 그 행에는 이미 서로 다른 두 명의 실제 승인이 기록돼 있다.
     * 새로 만들면 승인자를 지어내야 하고, 그건 D-21 로 막은 것을 코드로 우회하는 일이다.
     *
     * 그래서 되돌릴 수 있는 대상은 **한 번이라도 실제로 적용된 적이 있는 설정**뿐이다.
     * 활성화된 적 없는 초안으로 가는 것은 되돌리기가 아니라 새 변경이다.
     *
     * 마감 임박 잠금(Freeze)은 여기 적용하지 않는다.
     * Freeze 는 새 변경을 멈추는 장치이지 복구를 멈추는 장치가 아니다.
     * 잘못된 설정으로 마감을 맞는 것이 훨씬 큰 사고다.
     */
    rollback(input: {
        targetConfigId: string;
        operator: string;
        reason: string;
    }): Promise<{
        restored: ConfigVersionRow;
        retired: string | null;
        activation: ActivationView;
    }>;
    /**
     * 마감 임박 구간인가. (§A14 Freeze)
     *
     * 마지막 몇 시간에 지원자가 몰리고, 그때의 설정 변경은 검증할 시간이 없다.
     * 활성 마감정책이 없으면 판단하지 않고 통과시킨다 — 그 경우는 마감 판정 자체가
     * 이미 거부되고 있어서, 여기서 또 막으면 원인이 가려진다.
     */
    private assertNotFrozen;
    private configJson;
    /** 설정 본문. 관리자 콘솔이 새 초안의 출발점으로 쓴다. */
    contentOf(configId: string): Promise<Record<string, unknown>>;
    active(cycleId: string): Promise<ConfigVersionRow | null>;
    /**
     * 한 모집의 설정 버전 목록. 관리자 콘솔의 승인 대기함이 쓴다.
     * 본문(config_json)은 싣지 않는다 — 무엇이 바뀌는지는 diff 로 본다.
     */
    list(cycleId: string): Promise<Array<ConfigVersionRow & {
        createdAt: string;
    }>>;
    load(configId: string): Promise<ConfigVersionRow>;
}
