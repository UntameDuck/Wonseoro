import { NextRequest, NextResponse } from 'next/server';
import { endSessionUrl, OIDC_MODE, SESSION_COOKIE } from '../../../../lib/auth';

/**
 * 로그아웃 — 콘솔 세션 쿠키를 지우고, 발급자 세션도 끝낼 주소를 돌려준다(화면이 그리로 이동).
 * 콘솔 화면에서 보낸 요청만 받는다(`x-requested-with`) — 다른 사이트가 담당자를 몰래 로그아웃시키지 못하게.
 */
export async function POST(req: NextRequest) {
  if (!OIDC_MODE) return NextResponse.json({ detail: '관리자 로그인이 구성되지 않았습니다.' }, { status: 404 });
  if (req.headers.get('x-requested-with') !== 'wonseoro-admin') {
    return NextResponse.json({ detail: '콘솔 화면에서 보낸 요청이 아닙니다.' }, { status: 403 });
  }
  const res = NextResponse.json({ logoutUrl: (await endSessionUrl()) ?? '/' });
  res.cookies.delete(SESSION_COOKIE);
  res.headers.set('cache-control', 'no-store');
  return res;
}
