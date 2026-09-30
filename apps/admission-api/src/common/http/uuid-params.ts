import type { FastifyInstance } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM } from '@wonseoro/contracts';
import { ProblemException } from '../problem/problem.exception';
import { requestTraceId } from '../problem/problem.filter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 경로 변수 중 식별자(…Id)인데 UUID 형식이 아닌 것. 없으면 null. */
export function malformedIdParam(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
    if (name.endsWith('Id') && typeof value === 'string' && !UUID.test(value)) return name;
  }
  return null;
}

/**
 * 경로의 식별자(applicationId·paymentId·documentId·submissionId·configId·policyId·exceptionId…)는
 * 모두 UUID 다. 형식이 틀린 값(`/applications/undefined`)은 **없는 자원과 같은 404** 로 답한다.
 *
 * 전에는 그 값이 DB 까지 가서 uuid 변환 오류로 500 이 났다. 500 은 "서버 고장" 이라 화면은
 * 재시도를 권하고, 관제는 장애로 센다. 소유권 검사보다 앞이라 남의 것·없는 것·형식 오류가 모두
 * 같은 404 다(D-28). 모든 경로에 걸리므로 관리자·내부 경로도 같다.
 */
export function installUuidParamGuard(fastify: FastifyInstance): void {
  fastify.addHook('preValidation', async (request, reply) => {
    const bad = malformedIdParam(request.params);
    if (!bad) return;
    const problem = {
      ...ProblemException.notFound('존재하지 않는 자원입니다.').problem,
      instance: request.url,
      traceId: requestTraceId(request),
    };
    return reply
      .status(404)
      .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
      .header('cache-control', CACHE_CONTROL_PII)
      .send(problem);
  });
}
