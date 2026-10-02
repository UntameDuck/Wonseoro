import { NextRequest, NextResponse } from 'next/server';
import { freshSession, OIDC_MODE, seal, SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth';
import {
  ADMISSION_API_URL,
  currentOperator,
  currentSession,
  productionBlocker,
  upstreamHeaders,
} from '../../../../lib/server';

/**
 * 운영 API 중계 — 브라우저는 `/api/admin/...` 을 부르고, 이 서버가 자격을 붙여
 * admission-api 의 `/admin/v1/...` 로 넘긴다.
 *
 * **열린 중계기가 되지 않게 한다.**
 *   - `/admin/v1/` 아래만 넘긴다. 경로에 `..` 가 끼면 거절한다
 *   - 관리자 로그인 모드: 로그인 세션이 있어야 넘긴다(조회도). 액세스 토큰이 곧 끝나면 갱신해 쿠키를 바꾼다.
 *     역할·인증 수준·재인증은 운영 API 가 판단한다 — 그 답(403·401 STEP_UP_REQUIRED)을 그대로 돌려준다
 *   - 개발 모드: 상태를 바꾸는 요청은 담당자가 정해져 있어야 한다. 누가 했는지 없는 승인은 없다
 *   - 상태를 바꾸는 요청은 `x-requested-with` 헤더가 있어야 한다. 다른 사이트의 폼이나
 *     단순 요청으로는 이 헤더를 못 붙인다(CORS preflight 에 걸린다). 쿠키만 믿고 넘기면
 *     다른 사이트가 담당자 이름으로 승인을 보낼 수 있다
 */
async function relay(req: NextRequest, path: string[], method: 'GET' | 'POST') {
  const blocked = productionBlocker();
  if (blocked) return problem(503, 'CONSOLE_DISABLED', blocked);

  if (path.length === 0 || path.some((seg) => seg === '..' || seg === '.' || seg.includes('/'))) {
    return problem(400, 'VALIDATION_FAILED', '허용되지 않는 경로입니다.');
  }
  if (method === 'POST' && req.headers.get('x-requested-with') !== 'wonseoro-admin') {
    return problem(403, 'FORBIDDEN', '콘솔 화면에서 보낸 요청이 아닙니다.');
  }

  let headers: Record<string, string>;
  let renewed: string | null = null;
  if (OIDC_MODE) {
    const stored = await currentSession();
    const fresh = stored ? await freshSession(stored) : null;
    if (!fresh) {
      const res = problem(401, 'UNAUTHENTICATED', '로그인이 필요합니다. 다시 로그인해 주십시오.');
      if (stored) res.cookies.delete(SESSION_COOKIE); // 갱신이 안 되는 세션은 지운다
      return res;
    }
    if (fresh.changed) renewed = seal(fresh.session);
    headers = upstreamHeaders(null, fresh.session);
  } else {
    const operator = await currentOperator();
    if (method === 'POST' && !operator) return problem(401, 'OPERATOR_REQUIRED', '담당자를 먼저 입력해 주십시오.');
    headers = upstreamHeaders(operator);
  }

  const url = new URL(`${ADMISSION_API_URL}/admin/v1/${path.map(encodeURIComponent).join('/')}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const key = req.headers.get('idempotency-key');
  if (key) headers['idempotency-key'] = key;
  let body: string | undefined;
  if (method === 'POST') {
    body = await req.text();
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, cache: 'no-store' });
  } catch {
    return problem(502, 'UPSTREAM_UNREACHABLE', '대학 접수 서버에 연결할 수 없습니다.');
  }
  const text = await res.text();
  const out = new NextResponse(text, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
  // 재인증 요구(RFC 9470)는 화면이 요구 수준·시간을 읽는다
  const challenge = res.headers.get('www-authenticate');
  if (challenge) out.headers.set('www-authenticate', challenge);
  if (renewed) out.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions());
  return out;
}

function problem(status: number, code: string, detail: string) {
  return NextResponse.json(
    { type: 'about:blank', title: detail, status, code, detail, traceId: '' },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return relay(req, (await ctx.params).path, 'GET');
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return relay(req, (await ctx.params).path, 'POST');
}
