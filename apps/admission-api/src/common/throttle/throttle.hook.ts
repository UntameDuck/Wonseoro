import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CACHE_CONTROL_PII, MEDIA_PROBLEM } from '@wonseoro/contracts';
import { AUTH_MODE, THROTTLE_MODE } from '../../config';
import { ProblemException } from '../problem/problem.exception';
import { requestTraceId } from '../problem/problem.filter';
import { AdaptiveThrottle, classifyRoute, RequestClass } from './adaptive-throttle';

/**
 * Adaptive Throttling 을 Fastify 에 건다 (T-M4-40, ADR-0007).
 *
 * THROTTLE_MODE
 *   enforce — 한도를 넘으면 429 + Retry-After (기본)
 *   observe — 판정만 세고 막지 않는다. 운영 첫 적용·한도 조정 때 쓴다
 *   off     — 걸지 않는다
 *
 * 신원이 없는 요청은 보지 않는다 — 인증 계층이 어차피 거절한다. IP 는 어디에도 쓰지 않는다.
 * 지표 라벨은 요청 종류·판정뿐이다. 지원자·원서 식별자는 넣지 않는다.
 */
const meter = metrics.getMeter('k-admission.throttle');
const decisions = meter.createCounter('throttle_decisions', {
  description: '지원자 단위 요청 한도 판정 수 (class·decision=allowed|burst|risk|released, mode)',
});
const tracked = meter.createObservableGauge('throttle_tracked_subjects', {
  description: '이 Pod 가 한도를 추적 중인 지원자 수',
});
for (const cls of ['read', 'save', 'create', 'upload', 'payment', 'cancel', 'finalize'] satisfies RequestClass[]) {
  for (const decision of ['allowed', 'burst', 'risk', 'released']) decisions.add(0, { class: cls, decision });
}

const SUBJECT_HEADER = AUTH_MODE === 'gateway' ? 'x-authenticated-applicant' : 'x-applicant-id';

function subjectOf(request: FastifyRequest): string | null {
  // oidc: 앞선 인증 훅이 토큰으로 확인한 지원자. 헤더는 아무나 쓸 수 있어 보지 않는다
  if (AUTH_MODE === 'oidc') return request.identity?.kind === 'applicant' ? request.identity.applicantId : null;
  const value = request.headers[SUBJECT_HEADER];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

function applicationIdOf(request: FastifyRequest): string | undefined {
  const params = request.params as Record<string, unknown> | undefined;
  const id = params?.applicationId;
  return typeof id === 'string' ? id : undefined;
}

export function installAdaptiveThrottle(
  fastify: FastifyInstance,
  throttle: AdaptiveThrottle = new AdaptiveThrottle(),
): AdaptiveThrottle | null {
  if (THROTTLE_MODE === 'off') return null;
  const logger = new Logger('throttle');
  tracked.addCallback((result) => result.observe(throttle.trackedSubjects));

  fastify.addHook('onRequest', async (request, reply) => {
    const cls = classifyRoute(request.method, request.routeOptions?.url);
    const subject = cls ? subjectOf(request) : null;
    if (!cls || !subject) return;

    let decision = throttle.check(subject, cls, applicationIdOf(request));
    // 위험 차단이라도 차단 뒤에 본인확인을 다시 한 토큰이면 푼다 (ADR-0009)
    if (!decision.allowed && decision.reason === 'RISK' && AUTH_MODE === 'oidc') {
      const authTime = request.identity?.kind === 'applicant' ? request.identity.authTime : null;
      if (authTime && throttle.releaseRiskByReauth(subject, authTime * 1000)) {
        decisions.add(1, { class: cls, decision: 'released' });
        logger.log(`RISK released by re-authentication class=${cls}`);
        decision = throttle.check(subject, cls, applicationIdOf(request));
      }
    }
    if (decision.allowed) {
      decisions.add(1, { class: cls, decision: 'allowed' });
      return;
    }
    decisions.add(1, { class: cls, decision: decision.reason.toLowerCase() });
    if (THROTTLE_MODE !== 'enforce') return;

    if (decision.reason === 'RISK' && firstRiskBlock(subject)) {
      // 사람이 찾을 문장. 지원자 식별자는 남기지 않는다 — trace_id 로 이어서 본다.
      // 지원자마다 5분에 한 번만 — 공격 중에 요청마다 남기면 로그가 먼저 무너진다 (횟수는 지표가 센다)
      logger.warn(`RISK throttle class=${cls} retryAfter=${decision.retryAfterSeconds}s`);
    }
    const problem = {
      ...ProblemException.rateLimited(decision.reason, decision.retryAfterSeconds).problem,
      instance: request.url,
      traceId: requestTraceId(request),
    };
    if (decision.reason === 'RISK' && AUTH_MODE === 'oidc') {
      // 기다리는 것 말고 바로 푸는 길 — 본인확인을 다시 하면 된다(RFC 9470 형식). 화면이 "본인확인 다시 하기" 를 보인다
      reply.header('www-authenticate', 'Bearer error="insufficient_user_authentication", error_description="Re-authenticate to continue", max_age=0');
    }
    return reply
      .status(429)
      .header('retry-after', String(decision.retryAfterSeconds))
      .header('content-type', `${MEDIA_PROBLEM}; charset=utf-8`)
      .header('cache-control', CACHE_CONTROL_PII)
      .send(problem);
  });

  active = throttle;
  return throttle;
}

let active: AdaptiveThrottle | null = null;

const riskLogged = new Map<string, number>();
function firstRiskBlock(subject: string, now = Date.now()): boolean {
  const last = riskLogged.get(subject);
  if (last !== undefined && now - last < 5 * 60_000) return false;
  if (riskLogged.size >= 10_000) riskLogged.clear();
  riskLogged.set(subject, now);
  return true;
}

/** 소유권 검사가 부른다(ownership.service). 훅이 걸려 있지 않으면(off·시험) 아무것도 하지 않는다. */
export function noteOwnershipMiss(applicantId: string): void {
  active?.noteOwnershipMiss(applicantId);
}
