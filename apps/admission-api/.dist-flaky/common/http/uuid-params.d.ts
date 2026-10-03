import type { FastifyInstance } from 'fastify';
/** 객체의 식별자(…Id) 중 UUID 형식이 아닌 것. 없으면 null. */
declare function malformedId(values: unknown): string | null;
/** 경로 변수 중 식별자(…Id)인데 UUID 형식이 아닌 것. 없으면 null. */
export declare const malformedIdParam: typeof malformedId;
/** 쿼리 중 식별자(…Id)인데 UUID 형식이 아닌 것. 없으면 null. */
export declare const malformedIdQuery: typeof malformedId;
/**
 * 경로의 식별자(applicationId·paymentId·documentId·submissionId·configId·policyId·exceptionId…)는
 * 모두 UUID 다. 형식이 틀린 값(`/applications/undefined`)은 **없는 자원과 같은 404** 로 답한다.
 *
 * 전에는 그 값이 DB 까지 가서 uuid 변환 오류로 500 이 났다. 500 은 "서버 고장" 이라 화면은
 * 재시도를 권하고, 관제는 장애로 센다. 소유권 검사보다 앞이라 남의 것·없는 것·형식 오류가 모두
 * 같은 404 다(D-28). 모든 경로에 걸리므로 관리자·내부 경로도 같다.
 */
export declare function installUuidParamGuard(fastify: FastifyInstance): void;
export {};
