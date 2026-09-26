import { NextResponse } from 'next/server';
import { ADMISSION_API_URL } from '../../../../lib/server';

/** 진행 중인 모집. 공개 API 라 토큰을 붙이지 않는다. */
export async function GET() {
  try {
    const res = await fetch(`${ADMISSION_API_URL}/api/v1/admission-cycles/current`, {
      cache: 'no-store',
    });
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
