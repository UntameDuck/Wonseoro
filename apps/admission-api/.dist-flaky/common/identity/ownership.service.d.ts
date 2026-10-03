import { Db } from '@wonseoro/server-kit';
export declare class Ownership {
    private readonly db;
    constructor(db: Db);
    /**
     * 형식이 틀린 식별자(`/applications/undefined`)는 없는 자원과 같다 — 404.
     * 전에는 DB 가 uuid 변환에 실패해 500 이 났다. 500 은 "서버 고장" 이라 화면이 재시도를 권한다.
     */
    private assertWellFormed;
    assertApplication(applicationId: string, applicantId: string): Promise<void>;
    assertPayment(paymentId: string, applicantId: string): Promise<void>;
    assertDocument(documentId: string, applicantId: string): Promise<void>;
    assertSubmission(submissionId: string, applicantId: string): Promise<void>;
}
