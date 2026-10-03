import { OnModuleInit } from '@nestjs/common';
import { Db } from '@wonseoro/server-kit';
import { AuditService } from '../audit/audit.service';
import { DeadlineService } from '../deadline/deadline.service';
import { FormSchemaService } from '../config/form-schema.service';
import { PaymentRow, PaymentService } from '../payment/payment.service';
export interface SubmissionRow {
    submissionId: string;
    applicationId: string;
    applicationNumber: string;
    requestedAt: string;
    paymentVerifiedAt: string;
    finalizedAt: string;
    deadlinePolicyVersion: string;
    configVersion: string;
}
export interface FinalizeInput {
    applicationId: string;
    applicantId: string;
    /** 제출 요청이 서버에 도달한 시각. 마감 정책이 이 값을 쓸 수 있다. */
    requestedAt: Date;
    /**
     * 누가 접수를 일으켰는가. 결제 확인이 곧 제출이면(D-42) 서버가 부른다 —
     * 감사에는 SYSTEM 으로 남기고, 제출 의사는 결제 의도를 만든 지원자의 것임을 함께 적는다.
     */
    trigger?: 'APPLICANT' | 'PAYMENT_CONFIRMED';
    traceId?: string;
    sourceIp?: string;
}
/**
 * 최종 접수 — 기술설계서 v1.0 §5.6, v1.1 §02
 *
 * 사용자에게는 "전형료 결제 및 원서접수" 한 번의 행위로 보이지만
 * 내부에서는 Payment 와 Submission 을 별도로 관리한다.
 *
 * ## 트랜잭션 순서 (§02 — 바꾸지 않는다)
 * ```
 * 1. Idempotency record 확인/잠금   ← 인터셉터가 선점, 여기서 Application 행 잠금
 * 2. Application 상태·버전·마감정책 확인
 * 3. 사전 검증된 Payment snapshot 확인   ← PG 재조회는 이 트랜잭션 이전에 끝나 있다
 * 4. Submission INSERT
 * 5. Application → FINALIZED 조건부 전이
 * 6. Outbox Event INSERT
 * 7. Audit Event INSERT
 * 8. Commit
 * ```
 *
 * ## 트랜잭션 밖에서 하는 것
 * PG 조회 · PDF 생성 · SMS · 메일 · **중앙 전송**
 *
 * 중앙 전송 실패는 접수 실패가 아니다. Outbox 에 남기고 사용자에게는 접수완료를 준다.
 * event-relay 가 나중에 보낸다. (v1.1 §10 §12)
 */
export declare class FinalizationService implements OnModuleInit {
    private readonly db;
    private readonly payments;
    private readonly deadline;
    private readonly forms;
    private readonly audit;
    private readonly logger;
    constructor(db: Db, payments: PaymentService, deadline: DeadlineService, forms: FormSchemaService, audit: AuditService);
    /**
     * 결제가 곧 제출이다 (D-42). 현행 원서접수와 같다 — 전형료 결제를 마치면 접수가 끝난다.
     *   - 결제창을 열기 전에 접수할 수 있는 원서인지 본다 (상태·입력·서류·마감)
     *   - 결제가 처음 확인되면(화면 확인·PG 콜백·재확인 워커 어느 쪽이든) 서버가 접수한다
     */
    onModuleInit(): void;
    /**
     * 결제 확인 직후의 자동 접수. 실패해도 결제 확인은 되돌리지 않는다 —
     * 사유를 감사에 남기고, 대조(PAYMENT_CONFIRMED_WITHOUT_SUBMISSION)와 Self-check 가 드러낸다.
     * 지원자는 화면에서 다시 제출할 수 있다(같은 finalize 경로).
     */
    autoFinalize(payment: PaymentRow): Promise<void>;
    /**
     * 접수 요청이 거절된 사실을 남긴다. 성공(APPLICATION_FINALIZED)만 남기면 "마감 3초 전에 제출을
     * 눌렀는데 결제 확인이 안 돼 거절됐다" 같은 구제 판정의 근거가 사라진다. (§01 A2 · v1.0 §9)
     * 기록 자체가 실패해도 원래 오류를 가리지 않는다.
     */
    private recordRejected;
    /**
     * 접수할 수 있는 원서인가 — 결제 전 확인과 접수 직전 확인이 같은 규칙을 쓴다.
     * 결제 여부와 마감은 보지 않는다. 결제는 finalize 가, 마감은 부르는 쪽이 제 시각으로 본다.
     */
    private assertReady;
    finalize(input: FinalizeInput): Promise<{
        submission: SubmissionRow;
        created: boolean;
    }>;
    private finalizeTracked;
    findSubmission(applicationId: string): Promise<SubmissionRow | null>;
    /** 접수증 발급 — 접수 기록을 돌려주고 RECEIPT_ISSUED 를 남긴다. */
    issueReceipt(submissionId: string, applicantId: string, context?: {
        traceId?: string;
        sourceIp?: string;
    }): Promise<SubmissionRow | null>;
    /** 접수증에 적을 전형·모집단위 이름 (T-M2-11 인수기준 "제출시각·전형·모집단위·상태", T-M5-56) */
    receiptNames(applicationId: string): Promise<{
        admissionTypeName: string;
        departmentName: string;
    }>;
    findBySubmissionId(submissionId: string): Promise<SubmissionRow | null>;
    /**
     * Outbox 적재. aggregate_sequence 는 Application 별 단조 증가여야 한다. (v1.1 §A3)
     * 중앙이 sequence gap 으로 유실을 탐지하기 때문이다.
     */
    private enqueueFinalizedEvent;
    /**
     * 접수번호. 추측 가능하면 남의 접수 상태를 훑을 수 있다. (§09 BOLA)
     * 연도·대학 접두사 + 무작위. 순번을 쓰지 않는다.
     */
    private issueApplicationNumber;
    /** 분쟁 시 이 값으로 접수 내용의 동일성을 확인한다. (v1.1 §A11) */
    private evidenceHash;
    private assertRequiredDocuments;
    private activeConfigVersion;
    private loadApplication;
    private loadFields;
}
