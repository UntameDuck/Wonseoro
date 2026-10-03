import { ApplicationStatus } from '@wonseoro/contracts';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { ApplicationStateService } from './application-state.service';
import { ProfileVaultClient } from './profile-vault.client';
export interface ApplicationRow {
    id: string;
    cycleId: string;
    applicantId: string;
    admissionTypeId: string;
    /** 추가문항 스키마를 고르는 키. (v1.1 §A5) */
    admissionTypeCode: string;
    departmentId: string;
    status: ApplicationStatus;
    version: string;
    lastSavedAt: string | null;
}
export interface CreateApplicationInput {
    cycleId: string;
    applicantId: string;
    admissionTypeId: string;
    departmentId: string;
    /**
     * 요청이 주장하는 중앙 가명 토큰(개발 헤더·게이트웨이). **믿지 않는다** — 등록된 지원자의 토큰과
     * 다르면 거절한다. Vault 조회에는 등록된 값을 쓴다. 남의 토큰을 보내 남의 공통원서를 끌어올 수 없게.
     */
    subjectToken?: string;
    universityId?: string;
    /** 전형 양식이 공통원서에서 가져오겠다고 표시한 항목. 비어 있으면 Vault 에 묻지 않는다. */
    requestedFields?: string[];
    traceId?: string;
    sourceIp?: string;
}
export interface PatchApplicationInput {
    applicationId: string;
    expectedVersion: bigint;
    admissionTypeId?: string;
    departmentId?: string;
    fields?: Record<string, unknown>;
    schemaVersion: string;
    traceId?: string;
    sourceIp?: string;
}
export declare class ApplicationRepository {
    private readonly db;
    private readonly audit;
    private readonly state;
    private readonly vault;
    constructor(db: Db, audit: AuditService, state: ApplicationStateService, vault: ProfileVaultClient);
    /**
     * 원서 생성.
     *
     * 생성의 멱등성은 idempotency_record 가 아니라 **자연키**가 보장한다.
     * UNIQUE (cycle_id, applicant_id, admission_type_id) WHERE status <> 'CANCELLED'
     * 같은 지원자가 한 전형에 **유효한** 원서를 둘 가질 수 없다 — 모집단위가 달라도.
     * "하나의 전형에서는 하나의 모집단위에만 지원" (대학입학전형기본사항, D-12, D-29)
     *
     * 따라서 같은 모집단위로의 재시도는 기존 원서를 그대로 돌려준다. 오류가 아니다.
     * 다른 모집단위면 409 다 — 기존 원서를 돌려주면 고른 모집단위로 만들어진 줄 안다.
     */
    create(input: CreateApplicationInput): Promise<{
        row: ApplicationRow;
        created: boolean;
    }>;
    findById(applicationId: string): Promise<ApplicationRow | null>;
    /**
     * 등록된 지원자의 중앙 가명 토큰. 요청이 다른 토큰을 주장하면 403 — 신원이 섞인 요청이다.
     * 등록되지 않은 지원자면 403 (전에는 외래키 오류로 500 이 났다). 지원자 등록은 본인확인(T-M5-02)의 일이다.
     */
    private registeredSubjectToken;
    /** 전형 ID 로 코드(양식 선택 키)를 찾는다. 이 주기의 전형이 아니면 400. */
    admissionTypeCode(cycleId: string, admissionTypeId: string): Promise<string>;
    fields(applicationId: string): Promise<Record<string, unknown>>;
    /**
     * 자동저장 / Draft 수정.
     *
     * 조건부 UPDATE 로 낙관적 동시성을 건다. (v1.1 §B3)
     * 읽고-검사하고-쓰면 마감 피크 경합에서 두 요청이 모두 통과한다.
     * affectedRows 가 0이면 다른 요청이 먼저 바꾼 것이므로 409 다.
     */
    patch(input: PatchApplicationInput): Promise<ApplicationRow>;
    /**
     * 최종 검증 결과를 상태에 반영한다. 통과하면 DRAFT → READY, 통과하지 못하면 READY → DRAFT
     * (저장 뒤 설정이 바뀌어 더는 맞지 않는 원서). 다른 상태는 건드리지 않는다.
     * 상태가 바뀌었으면 새 행을 돌려준다 — 화면은 새 ETag 로 이어서 저장해야 한다.
     */
    markValidated(applicationId: string, valid: boolean): Promise<ApplicationRow | null>;
    /** 전형·모집단위가 이 주기 소속이고 모집 중(active)인가. 아니면 400 — 고를 수 없는 선택지다. */
    private assertCatalog;
    private selectOne;
    private toRow;
}
