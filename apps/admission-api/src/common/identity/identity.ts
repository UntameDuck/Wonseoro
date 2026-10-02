import type { FastifyRequest } from 'fastify';
import { AUTH_MODE } from '../../config';
import { ProblemException } from '../problem/problem.exception';

/**
 * 호출자 신원 — 기술설계서 v1.1 §06, T-M5-02
 *
 * 지금은 인증 게이트웨이가 없다. 그래서 **신원을 어디서 얻는지를 설정으로 못 박고**,
 * 개발용 경로가 운영에 섞여 들어가지 못하게 한다. (config.ts AUTH_MODE)
 *
 *   dev-headers — 헤더를 그대로 믿는다. 누구나 남을 사칭할 수 있다. 개발 전용
 *   gateway     — 앞단 게이트웨이가 검증해 넣어준 값만 받는다
 *   oidc        — 이 API 가 토큰을 검증해 붙인 `request.identity` 만 본다(oidc-auth.ts). 헤더는 읽지 않는다
 *
 * 이 파일을 한 곳에 둔 이유는, 전에는 컨트롤러 네 곳이 각자 헤더를 읽고 있었기 때문이다.
 * 인증을 붙일 때 고쳐야 할 자리가 넷이면 하나는 빠뜨린다.
 */

export interface ApplicantIdentity {
  applicantId: string;
  subjectToken?: string;
}

export interface AdminIdentity {
  adminId: string;
}

/** 게이트웨이가 검증 후 넣어주는 헤더. 브라우저가 직접 보낼 수 없도록 Edge 에서 제거한다. */
const GATEWAY_APPLICANT = 'x-authenticated-applicant';
const GATEWAY_ADMIN = 'x-authenticated-admin';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function applicantFrom(req: FastifyRequest): ApplicantIdentity {
  if (AUTH_MODE === 'oidc') {
    const identity = req.identity;
    // 훅이 이 경로에 지원자 토큰을 요구한다. 없으면 열지 않는다(경로 분류가 틀렸을 때의 마지막 문)
    if (identity?.kind !== 'applicant') throw ProblemException.unauthenticated();
    return { applicantId: identity.applicantId, subjectToken: identity.subjectToken };
  }

  const id =
    AUTH_MODE === 'gateway'
      ? header(req, GATEWAY_APPLICANT)
      : header(req, 'x-applicant-id');

  if (!id) throw ProblemException.forbidden('지원자를 식별할 수 없습니다.');

  const subjectToken =
    AUTH_MODE === 'gateway' ? header(req, 'x-authenticated-subject') : header(req, 'x-subject-token');

  return { applicantId: id, ...(subjectToken ? { subjectToken } : {}) };
}

export function adminFrom(req: FastifyRequest): AdminIdentity {
  if (AUTH_MODE === 'oidc') {
    const identity = req.identity;
    if (identity?.kind !== 'staff') throw ProblemException.unauthenticated();
    // 2인 승인의 "다른 사람" 판단·감사의 행위자 — 토큰의 담당자다. 화면이 보낸 이름은 쓰지 않는다
    return { adminId: identity.adminId };
  }

  const id =
    AUTH_MODE === 'gateway' ? header(req, GATEWAY_ADMIN) : header(req, 'x-admin-id');

  if (!id) throw ProblemException.forbidden('운영자를 식별할 수 없습니다.');
  return { adminId: id };
}
