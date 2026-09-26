import { NextRequest, NextResponse } from 'next/server';
import { OPERATOR_COOKIE, currentOperator, productionBlocker } from '../../../lib/server';

/**
 * 담당자 지정 — **개발 전용.** 관리자 SSO(T-M5-10) 가 이 자리를 대신한다.
 *
 * 입력한 이름이 그대로 `x-admin-id` 가 되어 승인·적용 기록에 남는다. 증명된 신원이 아니다.
 * 그래서 운영에서는 거절한다(productionBlocker).
 *
 * SameSite=Strict — 다른 사이트에서 시작한 요청에는 이 쿠키가 실리지 않는다.
 */
export async function GET() {
  return NextResponse.json({ operator: await currentOperator(), devOnly: true });
}

export async function POST(req: NextRequest) {
  const blocked = productionBlocker();
  if (blocked) return NextResponse.json({ detail: blocked }, { status: 503 });
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
  const res = NextResponse.json({ operator: null });
  res.cookies.delete(OPERATOR_COOKIE);
  return res;
}
