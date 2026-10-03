import { CircuitBreaker, CircuitSnapshot } from '@wonseoro/server-kit';
/**
 * 접수 API 가 기대는 외부 의존성과 그 Circuit Breaker. (v1.1 §01 C8)
 *
 * 의존성마다 **끊겼을 때의 규칙이 다르다.** 규칙은 호출하는 쪽에 있다.
 *
 *   centralVault — fail-open. 끊기면 빈 Snapshot 으로 원서를 만든다. (D-18)
 *                  중앙은 편의 계층이다. 편의가 없다고 접수 기회를 잃으면 안 된다
 *   paymentGateway — **fail-open 금지.** 확인 못 한 결제를 CONFIRMED 로 넘기면
 *                  돈을 안 받고 접수시키는 것이다. 끊기면 UNKNOWN 으로 두고
 *                  Reconciliation 에 맡긴다. (§B4)
 *
 * 문자·메일은 아직 없다. 붙일 때 여기에 추가하고, 끊겼을 때의 규칙을 함께 정한다.
 */
export declare class DependencyBreakers {
    private readonly logger;
    readonly centralVault: CircuitBreaker;
    readonly paymentGateway: CircuitBreaker;
    /**
     * 중앙 생존 확인 전용. Health Gate 의 주기 확인만 이것을 쓴다.
     * Vault 회로와 나누는 이유 — 중앙은 살아 있는데 Vault 경로만 고장 날 수 있다.
     * 둘을 섞으면 한쪽 성공이 다른 쪽 회로를 닫아 열림·닫힘이 반복된다.
     */
    readonly centralHealth: CircuitBreaker;
    snapshot(): CircuitSnapshot[];
    private create;
    /** 열림은 경보 대상이다. 닫힘은 복구 확인이다. 둘 다 남긴다. */
    private report;
}
export declare class ResilienceModule {
}
