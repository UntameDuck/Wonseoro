export type Outcome = 'success' | 'conflict' | 'rejected' | 'error';
/** 던져진 예외를 KPI 결과로 나눈다. 4xx 업무 예외는 거절, 412 는 충돌, 나머지는 시스템 오류다. */
export declare function classifyFailure(error: unknown): Exclude<Outcome, 'success'>;
export declare function trackDraftSave<T>(fn: () => Promise<T>): Promise<T>;
/** 결제 재검증. 결과 상태를 받아 verified·pending·failed·unverified 로 센다. */
export declare function trackPaymentVerify<T extends {
    status: string;
}>(fn: () => Promise<{
    row: T;
    unverified: boolean;
}>): Promise<T>;
export declare function trackFinalize<T extends {
    created: boolean;
}>(trigger: 'applicant' | 'payment_confirmed', fn: () => Promise<T>): Promise<T>;
