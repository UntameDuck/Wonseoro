import { DependencyBreakers } from '../../common/resilience/dependency-breakers';
export interface ProfileSnapshot {
    fields: Record<string, unknown>;
    releasedFields: string[];
    withheldFields: string[];
    /** 중앙에서 실제로 받아왔는가. false 면 빈 원서로 시작한다. */
    available: boolean;
}
/**
 * Common Profile Vault 클라이언트 — 기술설계서 v1.1 §10 §3
 *
 * **Snapshot 은 best-effort 다.** (불일치 대장 D-18)
 *
 * §10 §1 은 "Snapshot 생성 후 작성·제출은 중앙과 무관"이라고 적는다.
 * 생성 시점에는 중앙이 필요하다는 뜻인데, 같은 표가 "중앙 검색 장애여도
 * 대학 직접 URL 접수 가능"이라고도 적는다. 둘을 모두 만족하려면
 * **중앙이 없을 때 빈 원서로라도 만들 수 있어야 한다.**
 *
 * 중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 이 제품의 전제가 무너진다.
 * 그래서 여기서는 실패를 삼키고 빈 Snapshot 을 돌려준다. 예외를 올리지 않는다.
 *
 * **Circuit Breaker 는 이 성질을 바꾸지 않는다.** (v1.1 §01 C8)
 * 바꾸는 것은 대기 시간뿐이다. 중앙이 죽은 것이 확인되면 매 원서 생성이
 * VAULT_TIMEOUT_MS 를 기다렸다 빈 원서로 가는 대신, 바로 빈 원서로 간다.
 */
export declare class ProfileVaultClient {
    private readonly breakers;
    private readonly logger;
    constructor(breakers: DependencyBreakers);
    /**
     * @param requestedFields 전형 양식이 공통원서에서 가져오겠다고 표시한 항목(`x-profile`).
     *   전에는 세 항목을 코드에 박아 두어, 양식에 없는 항목까지 Vault 에 요청했다(목적 최소화 위반).
     */
    fetchSnapshot(args: {
        subjectToken: string;
        universityId: string;
        applicationRef: string;
        requestedFields: string[];
    }): Promise<ProfileSnapshot>;
}
