import { Db } from '@wonseoro/server-kit';
import { ActivationRecorder } from '../activation/activation-recorder';
import type { SignatureStatus } from '../activation/activation-signer';
import { AuditService } from '../audit/audit.service';
export interface EvidenceTimelineEntry {
    at: string;
    action: string;
    result: string;
    actorType: string;
    /** 가명 식별자. 원본 신원을 싣지 않는다. */
    actorId: string | null;
    traceId: string | null;
    configVersion: string | null;
    policyVersion: string | null;
    eventHash: string;
    prevHash: string;
}
export interface EvidencePackage {
    applicationId: string;
    generatedAt: string;
    evidenceHash: string;
    application: {
        status: string;
        version: string;
        cycleId: string;
        admissionTypeCode: string;
        departmentCode: string;
    };
    submission: {
        applicationNumber: string;
        requestedAt: string;
        paymentVerifiedAt: string;
        finalizedAt: string;
        deadlinePolicyVersion: string;
        configVersion: string;
        serverClockOffsetMs: number;
        evidenceHash: string;
    } | null;
    deadlinePolicy: {
        version: string;
        mode: string;
        deadlineAt: string;
        approvedBy: string[];
        activatedAt: string | null;
        policyHash: string;
        /**
         * 이 정책을 적용한 서명된 기록. (T-M3-15)
         * null 이면 서명 기록이 도입되기 전에 적용된 정책이다 — 승인자는 있지만
         * "누가 적용했는가" 와 "그 뒤로 바뀌지 않았는가" 는 증명하지 못한다.
         */
        signedActivation: {
            activationId: string;
            kind: string;
            effectiveAt: string;
            operatorId: string;
            decisionRef: string | null;
            keyId: string;
            signature: SignatureStatus;
            /** 서명된 마감시각·정책해시가 지금 DB 의 정책과 같은가. 다르면 정책 행이 고쳐졌다. */
            matchesPolicy: boolean;
        } | null;
    } | null;
    configVersion: {
        version: string;
        configHash: string;
        activatedAt: string | null;
    } | null;
    payments: Array<{
        provider: string;
        status: string;
        amount: number;
        providerApprovedAt: string | null;
        verifiedAt: string | null;
        events: Array<{
            eventType: string;
            occurredAt: string | null;
            payloadHash: string;
        }>;
    }>;
    documents: Array<{
        documentType: string;
        status: string;
        sha256: string;
        scans: Array<{
            scanner: string;
            engineVersion: string | null;
            result: string;
            scannedAt: string | null;
        }>;
    }>;
    consents: Array<{
        consentCode: string;
        policyVersion: string;
        grantedAt: string;
    }>;
    timeline: EvidenceTimelineEntry[];
    chainVerification: {
        valid: boolean;
        checked: number;
        brokenAt?: string;
    };
}
/**
 * Evidence Package — 기술설계서 v1.1 §A11·§C6, §09 Repudiation (T-M3-07)
 *
 * **"특정 Application 의 접수과정을 Evidence Package 로 재구성 가능"** 이
 * §01 E 의 핵심 인수기준이다.
 *
 * 2026년 장애에서 구제 판정의 근거가 된 것이 바로 이 기록이다 —
 * 작성·저장·제출·결제 시도 이력. 당시에는 사업자가 로그를 뒤져 사후에 맞췄다.
 * 여기서는 처음부터 **재구성 가능한 형태로** 남긴다.
 *
 * 담기는 것
 *   - 원서 상태와 접수 확정 기록 (접수번호·시각·적용된 정책·설정 버전)
 *   - 그 시점에 **실제로 적용된** 마감정책 스냅샷과 승인자
 *   - 결제 증적 (원문 없이 해시와 상태 전이만)
 *   - 서류 검사 결과
 *   - 동의 기록
 *   - 감사 Timeline + **hash-chain 검증 결과**
 *   - 서버 clock offset (§A9 — 시각 분쟁 대응)
 *
 * 담기지 않는 것
 *   이름·주민등록번호·연락처·주소·원서 본문·첨부파일 원본
 *   이것들 없이도 "언제 무엇을 했는가"는 증명된다.
 *
 * ⚠️ 조회 자체가 감사 대상이다. (§8.3 "민감정보 조회는 목적·사유 입력 및 별도 Audit")
 */
export declare class EvidenceService {
    private readonly db;
    private readonly audit;
    private readonly activations;
    private readonly logger;
    constructor(db: Db, audit: AuditService, activations: ActivationRecorder);
    /**
     * @param reason 조회 사유. 비워둘 수 없다 — 누가 왜 봤는지가 남아야 한다.
     */
    generate(applicationId: string, viewer: string, reason: string): Promise<EvidencePackage>;
    /** 열람 자체를 감사에 남긴다. 누가 왜 봤는지가 사후에 확인되어야 한다. */
    private recordAccess;
    private loadApplication;
    private loadSubmission;
    /** 접수 시점에 **실제로 적용된** 정책. 지금 활성인 정책이 아니다. */
    private loadPolicy;
    private loadConfig;
    private loadPayments;
    private loadDocuments;
    private loadConsents;
    private loadTimeline;
}
