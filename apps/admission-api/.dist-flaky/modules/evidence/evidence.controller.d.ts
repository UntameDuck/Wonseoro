import type { FastifyRequest } from 'fastify';
import { EvidenceService } from './evidence.service';
/**
 * Evidence Package — canonical: k-admission-openapi.yaml
 *   getEvidencePackage, security: [{ oidc: [auditor] }]
 *
 * oidc 모드: security-auditor 역할 + 비밀번호·OTP + **방금 한 인증**(Step-up)이어야 연다 (T-M5-10).
 * 그 밖의 모드: AdminGuard 의 공유 비밀, `x-admin-id` 는 열람자 기록용이다.
 *
 * **조회 사유가 필수다.** (§8.3)
 * 증적 열람은 그 자체로 감사 대상이고, 누가 왜 봤는지가 남아야 한다.
 * 계약에는 사유 파라미터가 없으므로 추가했다. (불일치 대장 D-24)
 */
export declare class EvidenceController {
    private readonly evidence;
    constructor(evidence: EvidenceService);
    get(applicationId: string, req: FastifyRequest, reason?: string): Promise<import("./evidence.service").EvidencePackage>;
}
