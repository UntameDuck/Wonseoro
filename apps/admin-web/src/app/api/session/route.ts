import { NextRequest, NextResponse } from 'next/server';
import { OIDC_MODE } from '../../../lib/auth';
import { DEV_OPERATOR, OPERATOR_COOKIE, currentOperator, currentSession, productionBlocker } from '../../../lib/server';

/**
 * 지금 담당자.
 *
 * 관리자 로그인 모드(T-M5-10) — 로그인 세션의 담당자 이름·표시 이름·역할·직접 인증 시각. 바꾸는 길은 로그인뿐이다
 * (`/api/auth/login`·`/api/auth/logout`). 토큰은 돌려주지 않는다.
 *
 * 개발 모드 — 담당자 지정(**개발 전용**). 입력한 이름이 그대로 `x-admin-id` 가 되어 승인·적용 기록에 남는다.
 * 증명된 신원이 아니다. 그래서 운영에서는 거절하고(productionBlocker), 개발 서버가 아니면 아예 받지 않는다(T-M5-53).
 * SameSite=Strict — 다른 사이트에서 시작한 요청에는 이 쿠키가 실리지 않는다.
 */
export async function GET() {
  if (OIDC_MODE) {
    const session = await currentSession();
    return NextResponse.json(
      {
        mode: 'oidc',
        operator: session?.user.username ?? null,
        name: session?.user.name ?? null,
        roles: session?.user.roles ?? [],
        authTime: session?.authTime ?? null,
        devOperator: false,
        unavailable: productionBlocker(),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  // devOperator 가 거짓이면 화면은 입력칸 대신 관리자 로그인 자리를 보인다.
  return NextResponse.json({ mode: 'dev', operator: await currentOperator(), devOperator: DEV_OPERATOR });
}

export async function POST(req: NextRequest) {
  const blocked = productionBlocker();
  if (blocked) return NextResponse.json({ detail: blocked }, { status: 503 });
  if (!DEV_OPERATOR) {
    return NextResponse.json({ detail: '담당자 지정은 개발 서버에서만 쓸 수 있습니다. 관리자 로그인으로 들어와 주십시오.' }, { status: 403 });
  }
  if (req.headers.get('x-requested-with') !== 'wonseoro-admin') {
    return NextResponse.json({ detail: '콘솔 화면에서 보낸 요청이 아닙니다.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { operator?: string };
  const operator = (body.operator ?? '').trim();
  if (!/^[A-Za-z0-9._@-]{2,64}$/.test(operator)) {
    return NextResponse.json(
      { detail: '담당자 ID 는 영문·숫자·._@- 2~64자로 입력해 주십시오.' },
      { status: 400 },
    );
  }

  const res = NextResponse.json({ operator });
  res.cookies.set(OPERATOR_COOKIE, operator, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 3600,
  });
  return res;
}

export async function DELETE() {
  if (OIDC_MODE) return NextResponse.json({ detail: '로그아웃을 이용해 주십시오.' }, { status: 405 });
  const res = NextResponse.json({ operator: null });
  res.cookies.delete(OPERATOR_COOKIE);
  return res;
}
