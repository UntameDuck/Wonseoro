import type { PoolClient } from 'pg';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { ActivationSigner, SignatureStatus } from './activation-signer';
export type ActivationSubject = 'DEADLINE_POLICY' | 'CONFIG_VERSION';
export type ActivationKind = 'ACTIVATE' | 'EXTEND' | 'ROLLBACK';
export interface ActivationInput {
    cycleId: string;
    subjectType: ActivationSubject;
    subjectId: string;
    subjectVersion: string;
    kind: ActivationKind;
    effectiveAt: Date;
    operatorId: string;
    reason?: string | null;
    decisionRef?: string | null;
    supersedesVersion?: string | null;
    /** 대상별로 서명에 함께 묶을 사실. 해시·승인자·마감시각 등. */
    content: Record<string, unknown>;
}
export interface ActivationView {
    activationId: string;
    subjectType: ActivationSubject;
    subjectId: string;
    subjectVersion: string;
    kind: ActivationKind;
    effectiveAt: string;
    operatorId: string;
    reason: string | null;
    decisionRef: string | null;
    supersedesVersion: string | null;
    content: Record<string, unknown>;
    keyId: string;
    payloadHash: string;
    recordedAt: string;
    /** 지금 다시 검증한 결과. 저장된 값이 아니다. */
    signature: SignatureStatus;
}
/**
 * 서명된 활성화 기록 — v1.1 §B17 · §A1 · §A14 (T-M3-14·15)
 *
 * 마감 정책·설정이 **적용되는 사건**마다 한 행을 남긴다.
 * 정책·설정 행은 "무엇" 이고, 이 행은 "언제·누가·왜 그것을 적용했는가" 다.
 *
 * **반드시 활성화와 같은 트랜잭션에서 부른다.** 활성화는 됐는데 기록이 없거나,
 * 기록은 있는데 활성화가 안 된 상태가 생기면 이 기록은 증거가 아니라 소문이 된다.
 *
 * 같은 트랜잭션에서 감사 체인에도 한 줄 남긴다. 서명은 "남은 행이 진짜인가" 를,
 * 감사 체인은 "빠진 사건이 없는가" 를 증명한다. 둘은 다른 질문이다.
 */
export declare class ActivationRecorder {
    private readonly db;
    private readonly signer;
    private readonly audit;
    constructor(db: Db, signer: ActivationSigner, audit: AuditService);
    record(client: PoolClient, input: ActivationInput): Promise<ActivationView>;
    /** 한 전형의 활성화 이력. 서명은 조회할 때마다 다시 검증한다. */
    list(cycleId: string, filter?: {
        subjectType?: ActivationSubject;
        subjectId?: string;
    }): Promise<ActivationView[]>;
    /**
     * 운영자 행위 감사 체인 검증. 서명은 남은 기록이 진짜인지를, 체인은 빠진 기록이
     * 없는지를 말한다. 활성화 기록을 누가 트리거를 끄고 지웠다면 여기서 드러난다.
     */
    verifySystemChain(): Promise<{
        valid: boolean;
        brokenAt?: string;
        checked: number;
    }>;
    private toView;
}
