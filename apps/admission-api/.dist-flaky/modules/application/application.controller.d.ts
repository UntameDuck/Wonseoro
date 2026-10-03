import type { FastifyReply, FastifyRequest } from 'fastify';
import { Ownership } from '../../common/identity/ownership.service';
import { FormSchemaService } from '../config/form-schema.service';
import { DeadlineService } from '../deadline/deadline.service';
import { ApplicationRepository } from './application.repository';
interface CreateBody {
    cycleId?: string;
    admissionTypeId?: string;
    departmentId?: string;
}
interface PatchBody {
    admissionTypeId?: string;
    departmentId?: string;
    fields?: Record<string, unknown>;
}
/**
 * Applicant API — 원서 생성 · 조회 · 자동저장
 * canonical: k-admission-openapi.yaml (createApplication / getApplication / updateApplication)
 *
 * 모든 응답에 serverTime 을 싣는다. 클라이언트가 자기 시계로 마감을 계산하지 않게 한다.
 */
export declare class ApplicationController {
    private readonly repo;
    private readonly deadline;
    private readonly forms;
    private readonly ownership;
    constructor(repo: ApplicationRepository, deadline: DeadlineService, forms: FormSchemaService, ownership: Ownership);
    create(body: CreateBody, req: FastifyRequest, reply: FastifyReply): Promise<{
        id: string;
        cycleId: string;
        admissionTypeId: string;
        departmentId: string;
        status: "DRAFT" | "READY" | "PAYMENT_PENDING" | "PAID" | "FINALIZING" | "FINALIZED" | "CANCELLED" | "EXPIRED";
        version: number;
        lastSavedAt: string | null;
        fields: Record<string, unknown>;
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
    }>;
    get(applicationId: string, req: FastifyRequest, reply: FastifyReply): Promise<{
        id: string;
        cycleId: string;
        admissionTypeId: string;
        departmentId: string;
        status: "DRAFT" | "READY" | "PAYMENT_PENDING" | "PAID" | "FINALIZING" | "FINALIZED" | "CANCELLED" | "EXPIRED";
        version: number;
        lastSavedAt: string | null;
        fields: Record<string, unknown>;
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
    }>;
    /**
     * 자동저장.
     * If-Match 가 필수다. (OpenAPI #/components/parameters/IfMatch)
     * 버전이 어긋나면 412 로 돌려준다 — 사용자의 입력을 덮어쓰지 않는다.
     */
    patch(applicationId: string, body: PatchBody, req: FastifyRequest, reply: FastifyReply): Promise<{
        id: string;
        cycleId: string;
        admissionTypeId: string;
        departmentId: string;
        status: "DRAFT" | "READY" | "PAYMENT_PENDING" | "PAID" | "FINALIZING" | "FINALIZED" | "CANCELLED" | "EXPIRED";
        version: number;
        lastSavedAt: string | null;
        fields: Record<string, unknown>;
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
    }>;
    private save;
    /**
     * 최종 검증. canonical: OpenAPI operationId validateApplication
     *
     * 예외를 던지지 않고 문제를 **전부 모아서** 돌려준다.
     * 사용자가 한 화면에서 고칠 것을 다 볼 수 있어야 한다. (v1.1 §07 Error Summary)
     */
    validate(applicationId: string, req: FastifyRequest, reply: FastifyReply): Promise<{
        valid: boolean;
        issues: import("../config/form-schema.service").ValidationIssue[];
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
    }>;
    private present;
    private required;
    private ifMatch;
    private context;
}
export {};
