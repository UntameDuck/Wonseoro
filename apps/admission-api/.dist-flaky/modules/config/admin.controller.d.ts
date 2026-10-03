import type { FastifyRequest } from 'fastify';
import { ActivationRecorder } from '../activation/activation-recorder';
import { DeadlinePolicyRepository } from '../deadline/deadline-policy.repository';
import { ConfigVersionService } from './config-version.service';
/**
 * 입학처 관리자 API — canonical: k-admission-openapi.yaml `/admin/v1/*`
 *
 * 기술설계서 v1.1 §A14·§C5, §01 E
 * **"단독 운영자 1명으로 마감시간 변경 불가"** 가 이 컨트롤러의 존재 이유다.
 *
 * ⚠️ 인증은 M5 다. (T-M5-10 Admin MFA + Step-up)
 * 그때까지는 AdminGuard 의 공유 비밀이 문을 지키고, `x-admin-id` 는 감사 기록용으로만 쓴다.
 * 공유 비밀은 누가 했는지 구분하지 못한다 — 문과 기록은 다른 문제다.
 *
 * `deadline-policies/{id}/activate`(D-22)·`deadline-policies/extensions`·`activations`(D-35) 는
 * 구현이 먼저 만들고 계약 v1.2.0 에 올렸다.
 *
 * 활성화·연장·되돌리기는 전부 **서명된 기록**으로 남는다. 누가 했는지는 `x-admin-id`
 * 에서 온다 — 공유 비밀 뒤라 신원 증명은 아니지만, 두 명의 서로 다른 승인자가
 * 서명된 기록에 함께 묶이므로 "한 사람이 혼자 바꿨다" 는 구별된다. (역할 분리는 T-M5-10)
 */
export declare class AdminController {
    private readonly configs;
    private readonly policies;
    private readonly activations;
    constructor(configs: ConfigVersionService, policies: DeadlinePolicyRepository, activations: ActivationRecorder);
    /**
     * 지금 적용 중인 설정 — 본문(config)까지 준다. 새 초안은 대개 지금 설정을 고쳐 만든다.
     * 본문을 볼 수 없으면 콘솔에서 초안을 만들 방법이 없어 API 를 직접 불러야 했다. (D-59)
     */
    activeConfig(cycleId?: string): Promise<{
        config: Record<string, unknown>;
        id: string;
        version: string;
        status: "DRAFT" | "APPROVED" | "ACTIVE" | "RETIRED";
        configHash: string;
        createdBy: string;
        approvedBy: string[];
        activatedAt: string | null;
    }>;
    /** 승인 대기함. 본문 없이 상태·승인자만. */
    listConfigs(cycleId?: string): Promise<{
        versions: (import("./config-version.service").ConfigVersionRow & {
            createdAt: string;
        })[];
    }>;
    createConfig(body: {
        cycleId?: string;
        version?: string;
        config?: Record<string, unknown>;
    }, req: FastifyRequest): Promise<import("./config-version.service").ConfigVersionRow>;
    /**
     * 승인 전에 무엇이 바뀌는지 본다. (§A14)
     * 이 응답의 `digest` 를 그대로 승인 요청에 실어 보낸다.
     */
    configDiff(configId: string): Promise<import("./config-diff").ConfigDiff>;
    /**
     * 승인. 본 Diff 의 digest 를 함께 받는다.
     * 승인자가 무엇이 바뀌는지 보지 못하면 두 명이 승인해도 사고를 막지 못한다.
     */
    approveConfig(configId: string, body: {
        acknowledgedDiffDigest?: string;
    }, req: FastifyRequest): Promise<{
        remainingApprovals: number;
        id: string;
        version: string;
        status: "DRAFT" | "APPROVED" | "ACTIVE" | "RETIRED";
        configHash: string;
        createdBy: string;
        approvedBy: string[];
        activatedAt: string | null;
    }>;
    /**
     * 되돌리기. 전에 적용된 적이 있는 설정으로만 갈 수 있다.
     * 마감 임박 잠금은 여기 걸지 않는다 — 잘못된 설정으로 마감을 맞는 쪽이 더 큰 사고다.
     */
    rollbackConfig(configId: string, body: {
        reason?: string;
    }, req: FastifyRequest): Promise<{
        restored: import("./config-version.service").ConfigVersionRow;
        retired: string | null;
        activation: import("../activation/activation-recorder").ActivationView;
    }>;
    activateConfig(configId: string, body: {
        activateAt?: string;
    }, req: FastifyRequest): Promise<import("./config-version.service").ConfigVersionRow & {
        activation: import("../activation/activation-recorder").ActivationView;
    }>;
    createPolicy(body: {
        cycleId?: string;
        version?: string;
        mode?: string;
        deadlineAt?: string;
    }, req: FastifyRequest): Promise<{
        policyId: string;
        policyHash: string;
    }>;
    /**
     * 마감 연장 초안. (v1.1 §B17, T-M3-14)
     *
     * 지금 적용 중인 정책을 기준으로만 만들고, 사유와 **입학처 결정 문서번호**가 필수다.
     * 이 시스템은 연장을 결정하지 않는다. 입학처의 결정을 기록하고 집행한다.
     * 그 뒤는 일반 정책과 같다 — 작성자가 아닌 두 명이 승인해야 적용된다.
     */
    createExtension(body: {
        cycleId?: string;
        deadlineAt?: string;
        reason?: string;
        decisionRef?: string;
    }, req: FastifyRequest): Promise<{
        policyId: string;
        policyHash: string;
        version: string;
        extendsVersion: string;
    }>;
    approvePolicy(policyId: string, req: FastifyRequest): Promise<{
        remainingApprovals: number;
        complete: boolean;
        policyId: string;
    }>;
    /** ⚠️ 계약에 없는 경로. Config 와 대칭을 맞추기 위해 추가했다. (D-22) */
    activatePolicy(policyId: string, body: {
        activateAt?: string;
    }, req: FastifyRequest): Promise<{
        activatedAt: string;
        activation: import("../activation/activation-recorder").ActivationView;
    }>;
    /** 마감정책 변경 이력. 분쟁 시 "누가 언제 바꿨는가"에 답한다. (§A2) */
    policyHistory(cycleId?: string): Promise<{
        policies: {
            policyId: string;
            version: string;
            mode: string;
            deadlineAt: string;
            status: import("@wonseoro/contracts").DeadlinePolicyStatus;
            approvedBy: string[];
            activatedAt: string | null;
            policyHash: string;
            createdBy: string;
            createdAt: string;
            extension: import("../deadline/deadline-policy.repository").ExtensionFacts | null;
        }[];
    }>;
    /**
     * 서명된 활성화 이력 — 마감 정책·설정 전부. (T-M3-15)
     * 조회할 때마다 서명을 다시 검증한다. 분쟁 시 "누가 언제 왜 적용했는가" 에 답한다.
     */
    activationHistory(cycleId?: string): Promise<{
        activations: import("../activation/activation-recorder").ActivationView[];
        allSignaturesValid: boolean;
        systemChain: {
            valid: boolean;
            brokenAt?: string;
            checked: number;
        };
    }>;
    private required;
    /** 감사·2인 승인의 담당자. oidc 모드에서는 담당자 토큰의 신원, 그 밖의 모드에서는 기록용 헤더다 */
    private admin;
}
