import { cookies } from 'next/headers';
import { type AdminSession, OIDC_MODE, oidcConfigProblem, SESSION_COOKIE, unseal } from './auth';

/**
 * 관리자 콘솔 서버 설정 — **브라우저에 내려가지 않는다.**
 *
 * 콘솔은 브라우저가 admission-api 를 직접 부르지 않고, 이 서버가 자격을 붙여 대신 부른다. 덤으로
 * admission-api 가 관리자 오리진에 CORS 를 열 필요도 없다.
 *
 * 자격은 모드에 따라 다르다.
 *   관리자 로그인(ADMIN_AUTH_MODE=oidc, T-M5-10) — 담당자 렐름 액세스 토큰(세션 쿠키 안, lib/auth.ts). 운영은 이것만
 *   그 밖(개발) — 운영 API 공유 비밀 `ADMIN_API_TOKEN` + 개발용 담당자 이름(`x-admin-id`). 신원 증명이 아니다
 */
export const ADMISSION_API_URL = process.env.ADMISSION_API_URL ?? 'http://localhost:3001';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? '';

export const OPERATOR_COOKIE = 'wonseoro_admin_operator';

/**
 * 개발용 담당자 지정이 켜져 있는가. 개발 서버에서만 참이다 — 운영 빌드에는 거짓이 박힌다(next.config.mjs). (T-M5-53)
 * 관리자 로그인 모드에서는 쓰지 않는다 — 담당자는 로그인으로만 정해진다.
 */
export const DEV_OPERATOR = !OIDC_MODE && process.env.WONSEORO_DEV_OPERATOR === '1';

/**
 * 쓸 수 없는 상태면 그 이유.
 *
 * 관리자 로그인 모드면 설정이 갖춰졌는지만 본다. 그 밖의 모드는 운영에서 쓰지 않는다 — "누가" 가
 * 개발용 입력칸에서 오면 이름만 바꿔 넣어 다른 사람으로 승인할 수 있다. 조용히 동작하지 않고 이유를 말하며 거절한다.
 */
export function productionBlocker(): string | null {
  if (OIDC_MODE) return oidcConfigProblem();
  if (process.env.NODE_ENV !== 'production') return null;
  return '관리자 로그인이 구성되지 않아 콘솔을 쓸 수 없습니다. 담당자 신원을 확인할 방법이 없습니다.';
}

/** 개발용 담당자 이름(개발 모드에서만) */
export async function currentOperator(): Promise<string | null> {
  if (!DEV_OPERATOR) return null;
  const v = (await cookies()).get(OPERATOR_COOKIE)?.value;
  return v && v.trim() ? v : null;
}

/** 관리자 로그인 세션(oidc 모드). 쿠키가 없거나 풀리지 않으면(위조·비밀 교체) null */
export async function currentSession(): Promise<AdminSession | null> {
  if (!OIDC_MODE) return null;
  return unseal<AdminSession>((await cookies()).get(SESSION_COOKIE)?.value);
}

/** admission-api 로 보낼 헤더. 자격은 여기서만 붙는다. */
export function upstreamHeaders(operator: string | null, session: AdminSession | null = null): Record<string, string> {
  if (session) return { authorization: `Bearer ${session.accessToken}` };
  const h: Record<string, string> = {};
  if (ADMIN_API_TOKEN) h.authorization = `Bearer ${ADMIN_API_TOKEN}`;
  if (operator) h['x-admin-id'] = operator;
  return h;
}
