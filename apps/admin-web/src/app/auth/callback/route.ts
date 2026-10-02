import { NextRequest, NextResponse } from 'next/server';
import {
  completeLogin,
  LoginError,
  OIDC_MODE,
  seal,
  SESSION_COOKIE,
  sessionCookieOptions,
  TX_COOKIE,
} from '../../../lib/auth';

/**
 * 로그인 콜백 — 발급자가 code 를 들고 돌려보내는 곳. 토큰을 받아 봉인 쿠키로 세션을 만들고 콘솔로 돌아간다.
 * 실패하면 콘솔 첫 화면에 이유를 알린다(`?login=failed`) — 화면이 다시 로그인 버튼을 보인다.
 */
export async function GET(req: NextRequest) {
  const home = new URL('/', req.nextUrl.origin);
  if (!OIDC_MODE) return NextResponse.redirect(home, 303);
  try {
    const { session, returnTo } = await completeLogin(req.nextUrl.searchParams, req.cookies.get(TX_COOKIE)?.value);
    const res = NextResponse.redirect(new URL(returnTo, req.nextUrl.origin), 303);
    res.cookies.set(SESSION_COOKIE, seal(session), sessionCookieOptions());
    res.cookies.delete(TX_COOKIE);
    res.headers.set('cache-control', 'no-store');
    return res;
  } catch (err) {
    const failed = new URL('/', req.nextUrl.origin);
    failed.searchParams.set('login', err instanceof LoginError ? 'failed' : 'unavailable');
    const res = NextResponse.redirect(failed, 303);
    res.cookies.delete(TX_COOKIE);
    return res;
  }
}
