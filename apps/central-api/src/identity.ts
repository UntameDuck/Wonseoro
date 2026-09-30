import { HttpException } from '@nestjs/common';
import { AUTH_MODE } from './config';

/** 개발 모드에서 지원자가 주장하는 가명 토큰. gateway 모드에서는 받지 않는다. */
export const DEV_SUBJECT_HEADER = 'x-subject-token';
/** 게이트웨이가 검증 후 넣는 가명 토큰. 브라우저가 직접 보낼 수 없도록 Edge 에서 지운다. */
export const GATEWAY_SUBJECT_HEADER = 'x-authenticated-subject';

/**
 * 요청의 지원자 가명 토큰. 인증 방식(AUTH_MODE)에 맞는 헤더만 본다 — 다른 헤더는 무시한다.
 * 없으면 400 (계약: APPLICANT_TOKEN_REQUIRED).
 */
export function subjectOf(headers: { dev?: string | undefined; gateway?: string | undefined }): string {
  const token = AUTH_MODE === 'gateway' ? headers.gateway : headers.dev;
  if (typeof token === 'string' && token.length > 0 && token.length <= 160) return token;
  throw new HttpException(
    {
      type: 'https://wonseoro.kr/problems/validation-failed',
      title: '요청이 올바르지 않습니다',
      status: 400,
      code: 'APPLICANT_TOKEN_REQUIRED',
      traceId: '',
      detail: '지원자를 식별할 수 없습니다.',
    },
    400,
  );
}
