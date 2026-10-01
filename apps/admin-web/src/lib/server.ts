import { cookies } from 'next/headers';

/**
 * 관리자 콘솔 서버 설정 — **브라우저에 내려가지 않는다.**
 *
 * `ADMIN_API_TOKEN` 은 운영 API 의 공유 비밀이다. 브라우저 JS 에 들어가면 화면을 연
 * 누구나 개발자 도구로 꺼내 쓸 수 있고, 그 뒤에는 마감 연장과 지원자 개인정보가 있다.
 * 그래서 콘솔은 브라우저가 admission-api 를 직접 부르지 않고, 이 서버가 토큰을 붙여
 * 대신 부른다. 덤으로 admission-api 가 관리자 오리진에 CORS 를 열 필요도 없다.
 */
export const ADMISSION_API_URL = process.env.ADMISSION_API_URL ?? 'http://localhost:3001';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? '';

export const OPERATOR_COOKIE = 'wonseoro_admin_operator';

/**
 * 개발용 담당자 지정이 켜져 있는가. 개발 서버에서만 참이다 — 운영 빌드에는 거짓이 박힌다(next.config.mjs). (T-M5-53)
 * 거짓이면 담당자 입력칸을 그리지 않고, 남아 있는 담당자 쿠키도 믿지 않는다. 그 자리는 관리자 SSO(T-M5-10)가 맡는다.
 */
export const DEV_OPERATOR = process.env.WONSEORO_DEV_OPERATOR === '1';

/**
 * 운영에서 쓸 수 있는 상태인가.
 *
 * 지금 "누가" 는 개발용 입력칸에서 온다. 신원 증명이 아니다. 관리자 SSO(T-M5-10) 전에는
 * 운영에서 이 콘솔을 쓰면 안 된다 — 이름만 바꿔 넣으면 다른 사람으로 승인할 수 있다.
 * 조용히 동작하지 않고 이유를 말하며 거절한다.
 */
export function productionBlocker(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;
  if (!ADMIN_API_TOKEN) return '운영 API 토큰(ADMIN_API_TOKEN)이 설정되지 않았습니다.';
  // 관리자 SSO(T-M5-10) 전에는 담당자 신원을 증명할 방법이 없다. 화면 문구에는 태스크 번호를 쓰지 않는다.
  return '관리자 로그인이 구성되지 않아 콘솔을 쓸 수 없습니다. 담당자 신원을 확인할 방법이 없습니다.';
}

export async function currentOperator(): Promise<string | null> {
  if (!DEV_OPERATOR) return null;
  const v = (await cookies()).get(OPERATOR_COOKIE)?.value;
  return v && v.trim() ? v : null;
}

/** admission-api 로 보낼 헤더. 토큰은 여기서만 붙는다. */
export function upstreamHeaders(operator: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (ADMIN_API_TOKEN) h.authorization = `Bearer ${ADMIN_API_TOKEN}`;
  if (operator) h['x-admin-id'] = operator;
  return h;
}
