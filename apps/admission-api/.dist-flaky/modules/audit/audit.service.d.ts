import type { PoolClient } from 'pg';
import { AuditAction } from '@wonseoro/contracts';
export interface AuditInput {
    applicationId?: string;
    actorType: 'APPLICANT' | 'ADMIN' | 'SYSTEM';
    /** 가명 식별자. 원본 식별자를 그대로 쓰지 않는다. */
    actorId?: string;
    action: AuditAction;
    result: 'ACCEPTED' | 'REJECTED' | 'FAILED';
    traceId?: string;
    configVersion?: string;
    policyVersion?: string;
    sourceIp?: string;
    /** 마스킹된 부가정보. 개인정보·요청 본문을 넣지 않는다. */
    details?: Record<string, unknown>;
}
/** 체인의 시작점. 첫 이벤트의 prev_hash. */
export declare const GENESIS_HASH: string;
/**
 * 감사 이벤트 기록 — 기술설계서 v1.0 §9, v1.1 §A11
 *
 * 보안로그가 아니라 **"마감 시각에 지원자가 어디까지 수행했는지"를 증명하는 업무 증적**이다.
 * 2026년 장애의 구제 판정에 작성·저장·제출·결제 시도 기록이 쓰였다.
 *
 * 절대 규칙
 *   1. 상태를 바꾸는 트랜잭션 **안에서** 기록한다. 커밋 후 별도로 쓰지 않는다.
 *      (별도로 쓰면 커밋은 됐는데 증적이 없는 구간이 생긴다)
 *   2. hash-chain 으로 이어 붙인다. 중간 레코드를 지우거나 고치면 검증에서 드러난다.
 *   3. 운영자에게 삭제·수정 권한을 주지 않는다. (M5 에서 WORM 저장소로 분리)
 *   4. 개인정보를 넣지 않는다. IP 는 원문이 아니라 해시로 남긴다.
 */
export declare class AuditService {
    /**
     * 트랜잭션 안에서 감사 이벤트를 기록한다.
     * 체인은 application 단위로 잇는다 — Evidence Package 가 원서 하나를 재구성해야 하므로.
     *
     * 원서에 딸리지 않은 이벤트(마감·설정 적용 같은 운영자 행위)는 **시스템 체인** 하나로
     * 잇는다. 전에는 이것들이 전부 GENESIS 에서 시작해 체인이 아니었다 — 하나를 지워도
     * 드러나지 않았다. 운영자 행위야말로 지워지면 안 되는 기록이다. (D-36)
     */
    record(client: PoolClient, input: AuditInput): Promise<string>;
    /**
     * 체인 무결성 검증. Evidence Package 생성 시 함께 돌린다. (M3 T-M3-07)
     * 한 건이라도 끊기면 그 지점을 반환한다. 순서는 시각이 아니라 앞 해시 연결로 따라간다(`walk`).
     */
    verifyChain(client: PoolClient, applicationId: string): Promise<{
        valid: boolean;
        brokenAt?: string;
        checked: number;
    }>;
    /**
     * 시스템 체인의 끝을 잡는다. 트랜잭션이 끝날 때까지 다른 기록은 기다린다.
     * 잠그지 않으면 두 활성화가 같은 끝을 보고 각자 이어붙여 체인이 갈라진다.
     */
    private lockSystemChain;
    /** 시스템 체인(운영자 행위) 검증. 끊긴 지점이 있으면 그 이벤트를 돌려준다. */
    verifySystemChain(client: PoolClient): Promise<{
        valid: boolean;
        brokenAt?: string;
        checked: number;
    }>;
    /**
     * 원서 체인의 끝을 잠그고 읽는다. 같은 원서의 기록은 이 잠금에서 줄을 선다.
     *
     * 새 advisory 잠금이 아니라 **원서 행 잠금**이다 — 원서를 바꾸는 흐름(저장·결제 의도·접수)은 이미 이
     * 행을 먼저 잠그므로 잠금 순서가 새로 생기지 않는다(교착 방지). `FOR NO KEY UPDATE` 라 다른 표의 행이
     * 이 원서를 참조하며 들어오는 것(외래키 KEY SHARE)은 막지 않는다.
     * READ COMMITTED 에서 잠금을 기다린 뒤의 다음 문장은 앞 트랜잭션이 커밋한 기록을 본다.
     */
    private lockApplicationChain;
    /**
     * 체인의 끝 — 아무도 앞 해시로 가리키지 않는 기록이다. 시각으로 고르지 않는다: 고치기 전 코드가
     * 시각이 뒤집힌 채 남긴 기록에서 "가장 늦은 시각" 은 끝이 아닐 수 있다(D-62).
     * 시각은 체인 전체에서 가장 늦은 것을 돌려준다 — 새 기록은 그보다 뒤에 둔다.
     */
    private chainTail;
    /**
     * 앞 해시 연결을 GENESIS 부터 따라가며 각 기록의 해시를 다시 계산한다.
     *
     * 시각 순서를 믿지 않는다(D-62) — 시각이 뒤집혀 쌓인 기록도 연결과 해시가 맞으면 변조가 아니다.
     * 끊김으로 보는 것: 해시 불일치(고침), 같은 앞 해시에 둘이 붙음(갈라짐 — 늦은 쪽을 지목),
     * 연결로 닿지 못한 기록(중간 기록이 지워짐 — 닿지 못한 것 중 가장 이른 기록을 지목).
     */
    private walk;
    private chainHash;
    /** IP 원문을 저장하지 않는다. (v1.0 §9 sourceIpHash) */
    /**
     * IP 는 원문으로 남기지 않는다. 소금이 고정값이면 가명처리가 아니다 —
     * IPv4 전체를 해시해 대조하면 몇 초면 원본이 나온다.
     * 그래서 운영에서는 소금이 없으면 기동하지 않는다.
     */
    private hashIp;
}
