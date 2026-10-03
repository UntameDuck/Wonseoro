import type { FastifyReply, FastifyRequest } from 'fastify';
import { Ownership } from '../../common/identity/ownership.service';
import { FinalizationService } from './finalization.service';
/**
 * 최종 접수 — canonical: k-admission-openapi.yaml
 *   finalizeApplication / getApplicationSubmission / getReceipt
 *
 * 재시도는 200, 신규 접수는 201. OpenAPI 가 둘을 구분한다.
 */
export declare class FinalizationController {
    private readonly finalization;
    private readonly ownership;
    constructor(finalization: FinalizationService, ownership: Ownership);
    finalize(applicationId: string, req: FastifyRequest, reply: FastifyReply): Promise<{
        applicationId: string;
        submissionId: string;
        applicationNumber: string;
        status: "FINALIZED";
        requestedAt: string;
        paymentVerifiedAt: string;
        finalizedAt: string;
        deadlinePolicyVersion: string;
        configVersion: string;
        serverTime: string;
    }>;
    get(applicationId: string, req: FastifyRequest): Promise<{
        applicationId: string;
        submissionId: string;
        applicationNumber: string;
        status: "FINALIZED";
        requestedAt: string;
        paymentVerifiedAt: string;
        finalizedAt: string;
        deadlinePolicyVersion: string;
        configVersion: string;
        serverTime: string;
    }>;
    /**
     * 접수증. 발급할 때마다 감사에 남긴다(RECEIPT_ISSUED) — "접수증을 받았다" 는 지원자가
     * 접수 완료를 확인한 증거다. 접수증 화면은 지원자 웹의 인쇄용 페이지가 그린다.
     */
    receipt(submissionId: string, req: FastifyRequest): Promise<{
        submissionId: string;
        applicationNumber: string;
        finalizedAt: string;
        admissionTypeName: string;
        departmentName: string;
        status: "FINALIZED";
    }>;
    private present;
    private context;
}
