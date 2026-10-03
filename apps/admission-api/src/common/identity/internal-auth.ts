import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM, ProblemCode, problemType } from '@wonseoro/contracts';
import { peerIdentity, type WorkloadIdentity } from '@wonseoro/server-kit';
import { INTERNAL, UNIVERSITY_ID } from '../../config';
import { requestTraceId } from '../problem/problem.filter';

/**
 * 내부 경로(`/internal/**`)의 상호 TLS 인증 — 대학 API (T-M5-05·09, docs/13 B1~B4, D-69)
 *
 * 서류 검사 워커만 부르는 경로 둘이다(검사 대기 목록 — 서류 내려받기 주소가 들어 있다 — 과 검사 결과 보고).
 * 전에는 공개 경로와 같은 포트에서 인증 없이 열려 있었다. 앞단이 경로를 거르지 않으면 바깥에서 지원자 서류를 받아 가거나
 * 악성 파일을 "깨끗함" 으로 보고할 수 있었다. 이제 **같은 대학의 서류 워커 인증서**만 받는다.
 * `INTERNAL_AUTH=none`(개발·단위 시험)이면 검사하지 않는다 — 운영에서는 기동이 막힌다.
 */

declare module 'fastify' {
  interface FastifyRequest {
    internalPeer?: WorkloadIdentity | null;
  }
}

/** 경로 → 부를 수 있는 워크로드(이 대학의 것만) */
export const INTERNAL_ROUTES: Record<string, readonly string[]> = {
  'GET /internal/v1/documents/pending-scan': ['document-service'],
  'POST /internal/v1/documents/:documentId/scan-result': ['document-service'],
};

const decisions = metrics.getMeter('k-admission.auth').createCounter('internal_auth_decisions', {
  description: '내부 경로 상호 TLS 판정 수 (result=ok|no-certificate|untrusted|no-identity|forbidden|plaintext)',
});

/** 어느 워크로드가 이 경로를 부를 수 있나 — 신원이 없으면 401, 있지만 아니면 403 */
export function internalDecision(method: string, url: string, identity: WorkloadIdentity | null): 'ok' | 401 | 403 {
  if (!identity) return 401;
  const allowed = INTERNAL_ROUTES[`${method} ${url}`];
  if (!allowed || identity.zone !== 'university' || identity.universityId !== UNIVERSITY_ID || !allowed.includes(identity.workload)) return 403;
  return 'ok';
}

export function installInternalAuth(fastify: FastifyInstance): void {
  const logger = new Logger('internal-auth');
  fastify.decorateRequest('internalPeer', null);
  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const url = request.routeOptions?.url;
    if (!url?.startsWith('/internal/') || INTERNAL.mode !== 'mtls') return;
    const { identity, problem } = peerIdentity(request.raw.socket);
    const decision = internalDecision(request.method, url, identity);
    decisions.add(1, { route: url, result: decision === 'ok' ? 'ok' : decision === 401 ? (problem ?? 'no-identity') : 'forbidden' });
    if (decision === 'ok') {
      request.internalPeer = identity;
      return;
    }
    logger.warn(`내부 경로 거절 ${request.method} ${url} — ${decision === 401 ? problem : 'forbidden'}${identity ? ` (${identity.uri})` : ''}`);
    const [code, title, detail] =
      decision === 401
        ? [ProblemCode.UNAUTHENTICATED, '내부 호출 인증이 필요합니다', '플랫폼이 발급한 워크로드 인증서로 다시 연결해 주십시오.']
        : [ProblemCode.FORBIDDEN, '이 경로를 부를 수 없는 워크로드입니다', '이 경로는 이 대학의 정해진 워크로드만 부를 수 있습니다.'];
    return reply
      .status(decision)
      .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
      .header('cache-control', CACHE_CONTROL_PII)
      .send({ type: problemType(code as never), title, status: decision, code, detail, instance: request.url, traceId: requestTraceId(request) });
  });
}
