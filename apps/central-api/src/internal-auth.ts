import { HttpException, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM, ProblemCode, problemType } from '@wonseoro/contracts';
import { peerIdentity, type WorkloadIdentity } from '@wonseoro/server-kit';
import { INTERNAL } from './config';

/**
 * 내부 경로(`/internal/**`)의 상호 TLS 인증 — 중앙 API (T-M5-05·09, docs/13 B1~B4, D-69)
 *
 * 계약은 내부 경로 여섯에 mutualTLS 를 요구한다. 전에는 인증 없이 열려 있어 **어느 대학이든 다른 대학 이름으로
 * 이벤트를 보내고, 다른 대학에 동의된 공통원서를 받아 갈 수 있었다** — 보낸 쪽이 본문에 적은 대학 ID 를 믿었다.
 *
 *   1. 경로마다 부를 수 있는 워크로드를 정한다(아래 표). 인증서 없음·플랫폼 CA 가 아님 → 401, 다른 워크로드 → 403
 *   2. 요청 안의 대학 ID 는 **인증서의 대학과 같아야 한다** — 각 컨트롤러가 `sameUniversity()` 로 본다
 *
 * `INTERNAL_AUTH=none`(개발·단위 시험)이면 검사하지 않는다 — 운영에서는 기동이 막힌다.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** 검증된 내부 호출자 — mtls 모드의 `/internal/**` 에서만 */
    internalPeer?: WorkloadIdentity | null;
  }
}

type Caller = { zone: 'university' | 'central'; workloads: readonly string[] };

/** 경로 → 부를 수 있는 워크로드 */
export const INTERNAL_ROUTES: Record<string, Caller> = {
  'POST /internal/v1/events': { zone: 'university', workloads: ['event-relay'] },
  'GET /internal/v1/events/:eventId/receipt': { zone: 'university', workloads: ['event-relay'] },
  'POST /internal/v1/profile-snapshots': { zone: 'university', workloads: ['admission-api'] },
  // 관제 — 대학별 적체·마지막 수신. 중앙 안의 워크로드만
  'GET /internal/v1/sync/status': { zone: 'central', workloads: ['ops-console', 'central-api'] },
};

const decisions = metrics.getMeter('k-admission.auth').createCounter('internal_auth_decisions', {
  description: '내부 경로 상호 TLS 판정 수 (result=ok|no-certificate|untrusted|no-identity|forbidden|mismatch|plaintext)',
});

function traceIdOf(request: FastifyRequest): string {
  const tp = request.headers.traceparent;
  return typeof tp === 'string' && tp.split('-')[1] ? (tp.split('-')[1] as string) : (request.id ?? '');
}

export function installInternalAuth(fastify: FastifyInstance): void {
  const logger = new Logger('internal-auth');
  fastify.decorateRequest('internalPeer', null);
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.routeOptions?.url;
    if (!url?.startsWith('/internal/') || INTERNAL.mode !== 'mtls') return;
    const caller = INTERNAL_ROUTES[`${request.method} ${url}`];
    const { identity, problem } = peerIdentity(request.raw.socket);
    let status = 0;
    let result: string = problem ?? 'ok';
    if (!identity) status = 401;
    else if (!caller || identity.zone !== caller.zone || !caller.workloads.includes(identity.workload)) {
      status = 403;
      result = 'forbidden';
    }
    decisions.add(1, { route: url, result });
    if (status === 0) {
      request.internalPeer = identity;
      return;
    }
    // 신원(URI)은 남긴다 — 어느 워크로드가 어디를 두드렸는지가 사고 조사의 실마리다. 인증서 원문은 남기지 않는다
    logger.warn(`내부 경로 거절 ${request.method} ${url} — ${result}${identity ? ` (${identity.uri})` : ''}`);
    const [code, title, detail] =
      status === 401
        ? [ProblemCode.UNAUTHENTICATED, '내부 호출 인증이 필요합니다', '플랫폼이 발급한 워크로드 인증서로 다시 연결해 주십시오.']
        : [ProblemCode.FORBIDDEN, '이 경로를 부를 수 없는 워크로드입니다', '이 경로는 정해진 워크로드만 부를 수 있습니다.'];
    return reply
      .status(status)
      .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
      .header('cache-control', CACHE_CONTROL_PII)
      .send({ type: problemType(code as never), title, status, code, detail, instance: request.url, traceId: traceIdOf(request) });
  });
}

/**
 * 요청 안의 대학 ID 가 인증서의 대학과 같은지 — 다르면 403(다른 대학 이름으로 보내기·남의 동의 가져가기).
 * none 모드(개발)에서는 검사하지 않는다.
 */
export function sameUniversity(request: FastifyRequest | undefined, claimed: unknown, what: string): void {
  if (INTERNAL.mode !== 'mtls') return;
  const peer = request?.internalPeer;
  if (peer && peer.zone === 'university' && typeof claimed === 'string' && claimed === peer.universityId) return;
  decisions.add(1, { route: request?.routeOptions?.url ?? '', result: 'mismatch' });
  new Logger('internal-auth').warn(`대학 불일치 — ${what}: 요청 ${String(claimed)} · 인증서 ${peer?.uri ?? '없음'}`);
  throw new HttpException(
    {
      type: problemType(ProblemCode.FORBIDDEN as never),
      title: '다른 대학의 정보입니다',
      status: 403,
      code: ProblemCode.FORBIDDEN,
      detail: '이 워크로드는 자기 대학의 정보만 보내거나 받을 수 있습니다.',
      traceId: request ? traceIdOf(request) : '',
    },
    403,
  );
}
