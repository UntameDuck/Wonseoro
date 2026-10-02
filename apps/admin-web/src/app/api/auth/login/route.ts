import { NextRequest, NextResponse } from 'next/server';
import { beginLogin, OIDC_MODE, oidcConfigProblem, secureCookies, TX_COOKIE } from '../../../../lib/auth';

/**
 * 관리자 로그인 시작 — 발급자 로그인 화면으로 보낸다. (T-M5-10)
 *   ?returnTo=/config   로그인 뒤 돌아올 콘솔 경로(같은 콘솔 안만)
 *   ?stepUp=1           민감 동작 전 다시 인증 — 비밀번호·OTP 를 다시 묻는다
 * state·nonce·PKCE 검증값은 봉인한 짧은 쿠키에 둔다(10분, HttpOnly). 콜백이 대조하고 지운다.
 */
export async function GET(req: NextRequest) {
  if (!OIDC_MODE) return NextResponse.json({ detail: '관리자 로그인이 구성되지 않았습니다.' }, { status: 404 });
  const problem = oidcConfigProblem();
  if (problem) return NextResponse.json({ detail: problem }, { status: 503 });

  let login: { url: string; tx: string };
  try {
    login = await beginLogin(req.nextUrl.searchParams.get('returnTo') ?? '/', req.nextUrl.searchParams.get('stepUp') === '1');
  } catch {
    return NextResponse.json({ detail: '로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주십시오.' }, { status: 502 });
  }
  const res = NextResponse.redirect(login.url, 303);
  res.cookies.set(TX_COOKIE, login.tx, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/', maxAge: 600 });
  res.headers.set('cache-control', 'no-store');
  return res;
}
