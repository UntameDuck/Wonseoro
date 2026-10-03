import type { FastifyRequest } from 'fastify';
import { Db } from '@wonseoro/server-kit';
import { Ownership } from '../../common/identity/ownership.service';
import { DeadlineService } from '../deadline/deadline.service';
interface TimelineEntry {
    at: string;
    what: string;
    result: string;
}
/**
 * Support Self-check — 기술설계서 v1.1 §01 C7 · §B11
 *
 * 계약: OpenAPI getApplicationSelfCheck (D-16).
 *
 * **사용자가 "서버가 아는 상태"를 직접 본다.**
 *
 * 2026년 장애 때 지원자가 자기 접수 여부를 확인할 길은 고객센터뿐이었다.
 * 그 사이 재결제·중복 제출이 발생했고, 사후에 1,588건의 구제 신청으로 이어졌다.
 * 이 화면이 있었다면 상당수는 "이미 접수되었습니다"를 스스로 확인하고 끝났을 것이다.
 *
 * 설계 원칙
 *   1. **추측하지 않는다.** 서버가 아는 것만 보여준다. 모르면 모른다고 한다
 *   2. 재결제를 유도하지 않는다. 결제 상태가 불확실하면 "확인 중"이다
 *   3. 중앙 동기화 상태와 접수 상태를 **분리해서** 보여준다 (v1.1 §07)
 *      중앙에 안 갔다고 접수가 안 된 것이 아니다
 *   4. 개인정보를 싣지 않는다. 상태와 시각만 준다
 *   5. **본인 원서만 보여준다.** 접수번호·결제 상태·시도 이력이 담긴다. 남의 원서와 없는 원서는
 *      같은 404 다 — 구분해 주면 식별자를 훑어 유효한 원서를 찾을 수 있다. (D-28 에서 빠졌던 경로)
 */
export declare class SelfCheckController {
    private readonly db;
    private readonly deadline;
    private readonly ownership;
    constructor(db: Db, deadline: DeadlineService, ownership: Ownership);
    selfCheck(applicationId: string, req: FastifyRequest): Promise<{
        applicationId: string;
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
        application: {
            status: string;
            lastSavedAt: string | null;
            summary: string;
        };
        submission: {
            submissionId: string;
            applicationNumber: string;
            finalizedAt: string;
            deadlinePolicyVersion: string;
        } | null;
        payment: {
            exists: boolean;
            guidance: string;
            paymentId?: undefined;
            status?: undefined;
            amount?: undefined;
            requestedAt?: undefined;
            providerApprovedAt?: undefined;
            verifiedAt?: undefined;
        } | {
            exists: boolean;
            paymentId: string;
            status: string;
            amount: number;
            requestedAt: string;
            providerApprovedAt: string | null;
            verifiedAt: string | null;
            guidance: string;
        };
        documents: {
            documentType: string;
            status: string;
            guidance: string;
        }[];
        /**
         * 중앙 동기화. **접수 여부와 분리해서 보여준다.**
         * pending 이어도 접수는 이미 완료다. (v1.1 §10 §12)
         */
        centralSync: {
            pending: number;
            sent: number;
            lastSentAt: string | null;
            guidance: string;
        };
        /** 저장·결제·제출 시도 이력. 구제 판정의 근거가 되는 그 기록이다 */
        timeline: TimelineEntry[];
    }>;
    private summarize;
    private loadApplication;
    private latestPayment;
    private submission;
    private documents;
    /**
     * 중앙 전송 현황.
     * pending 이 있어도 **접수는 이미 완료**다. 화면이 이 둘을 섞지 않게 문구를 함께 준다.
     */
    private centralSync;
    /**
     * 저장·결제·제출 시도 이력.
     * 2026년 구제 판정에 쓰인 것이 바로 이 기록이다. 사용자가 직접 볼 수 있어야 한다.
     * 개인정보는 싣지 않는다 — 무엇을 언제 했는지만 준다.
     */
    private timeline;
}
export {};
