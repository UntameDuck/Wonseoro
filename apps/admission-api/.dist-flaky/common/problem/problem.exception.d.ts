import { HttpException } from '@nestjs/common';
import { ProblemCodeValue, ProblemDetails } from '@wonseoro/contracts';
type ProblemInit = Omit<ProblemDetails, 'type' | 'code' | 'traceId'> & {
    code: ProblemCodeValue;
    traceId?: string;
};
/**
 * 모든 업무 오류는 이 예외로 던진다.
 * canonical: k-admission-openapi.yaml #/components/schemas/Problem
 *
 * `code` 와 `traceId` 는 계약상 필수다. traceId 는 필터가 요청에서 채운다.
 */
export declare class ProblemException extends HttpException {
    readonly problem: ProblemDetails;
    /** 응답에 함께 실을 헤더 — 예: 401 의 `WWW-Authenticate` (RFC 6750·9470) */
    readonly headers: Readonly<Record<string, string>>;
    constructor(init: ProblemInit, headers?: Record<string, string>);
    /** 토큰이 없거나 틀렸다 — 다시 로그인. 무엇이 틀렸는지는 응답에 쓰지 않는다(위조 시도에 단서를 주지 않는다) */
    static unauthenticated(): ProblemException;
    /**
     * 방금 한 인증이 필요하다 — RFC 9470 Step-up 형식. 화면은 `acr_values`·`max_age` 로 다시 로그인시킨다.
     * @param maxAgeSec 직접 인증 후 허용 시간. 없으면 인증 수준만 모자란 것
     */
    static stepUpRequired(acr: string, maxAgeSec?: number): ProblemException;
    /** 발급자 공개키를 쓸 수 없어 판단하지 못했다 — 토큰 탓이 아니다 */
    static authUnavailable(): ProblemException;
    static validationFailed(detail: string): ProblemException;
    static idempotencyKeyRequired(): ProblemException;
    static idempotencyKeyInvalid(detail: string): ProblemException;
    static idempotencyKeyReused(): ProblemException;
    /**
     * If-Match 불일치. OpenAPI updateApplication 이 412 를 명시한다.
     * 409(VERSION_CONFLICT)는 상태 충돌용으로 구분해 쓴다.
     */
    static preconditionFailed(detail: string): ProblemException;
    static versionConflict(detail: string): ProblemException;
    static illegalTransition(from: string, to: string): ProblemException;
    /**
     * 접수 완료 후 취소 시도. (불일치 대장 D-7)
     * "불가능" 이 아니라 "이 경로로는 안 된다" 로 말한다 —
     * 실제로 취소·환불이 필요한 사정이 있을 수 있고, 그때 갈 곳을 알려줘야 한다.
     */
    static cancellationAfterFinalize(): ProblemException;
    /**
     * 같은 전형에 다른 모집단위로 유효한 원서가 이미 있다. (D-29)
     * 대학입학전형기본사항 — "하나의 전형에서는 하나의 모집단위에만 지원할 수 있음".
     * 기존 원서를 조용히 돌려주면 지원자는 고른 모집단위로 만들어진 줄 안다.
     */
    static oneDepartmentPerAdmissionType(): ProblemException;
    /** 지원자 단위 요청 한도 초과 (T-M4-40). reason 은 BURST(짧은 폭주) 또는 RISK(위험 신호 누적). */
    static rateLimited(reason: 'BURST' | 'RISK', retryAfterSeconds: number): ProblemException;
    static alreadyFinalized(): ProblemException;
    /**
     * 마감 관련 오류에는 분쟁 대응을 위해
     * serverTime · deadlineAt · deadlinePolicyVersion 을 반드시 싣는다. (v1.1 §A2)
     */
    static deadlinePassed(args: {
        serverTime: string;
        deadlineAt: string;
        deadlinePolicyVersion: string;
    }): ProblemException;
    /** 결제가 서버 재검증을 통과하지 않았다. CONFIRMED 만 Finalize 에 쓸 수 있다. */
    static paymentNotConfirmed(): ProblemException;
    /**
     * 이미 진행 중이거나 확정된 결제가 있다. 새 결제창을 열지 않는다 — 이중 결제가 확인 지연보다
     * 큰 사고다. (v1.1 §B4)
     */
    static paymentInProgress(detail: string): ProblemException;
    /** 결제 상태를 PG 에서 확인하지 못했다. 재결제를 유도하지 않는다. (v1.1 §B4) */
    static paymentStateUnknown(): ProblemException;
    static documentNotAvailable(detail: string): ProblemException;
    /** 업무 검증 실패. OpenAPI finalizeApplication 이 422 를 명시한다. */
    static unprocessable(detail: string): ProblemException;
    /** 권한·절차 위반. 2인 승인 규칙 위반이 여기로 온다. */
    /** 없는 자원. 남의 자원도 같은 응답이다 — 존재 여부를 알려주지 않는다. (D-28) */
    static notFound(detail: string): ProblemException;
    static forbidden(detail: string): ProblemException;
    static retryable(detail: string): ProblemException;
}
export {};
