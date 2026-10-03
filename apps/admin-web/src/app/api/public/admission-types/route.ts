import { NextRequest, NextResponse } from 'next/server';
import { ADMISSION_API_URL } from '../../../../lib/server';

/**
 * 전형 Schema 온보딩 화면이 쓸 공개 전형 목록.
 * 브라우저가 대학 API를 직접 부르지 않게 같은 오리진에서 그대로 전달한다.
 */
export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get('cycleId');
  if (!cycleId) {
    return NextResponse.json({ detail: '모집을 지정해 주십시오.' }, { status: 400 });
  }
  try {
    const url = new URL('/api/v1/admission-types', ADMISSION_API_URL);
    url.searchParams.set('cycleId', cycleId);
    const res = await fetch(url, { cache: 'no-store' });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { detail: '대학 접수 서버에 연결할 수 없습니다.' },
      { status: 502 },
    );
  }
}
