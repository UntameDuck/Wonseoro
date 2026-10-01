'use client';

import { problemText } from '@wonseoro/contracts';

/**
 * 콘솔 화면의 호출 계층. 화면은 fetch 를 직접 부르지 않는다.
 *
 * 브라우저는 admission-api 를 직접 부르지 않는다. 같은 오리진의 `/api/admin/*` 를
 * 부르면 콘솔 서버가 운영 토큰을 붙여 넘긴다. (토큰은 브라우저에 없다)
 */

export interface Problem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  traceId?: string;
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title ?? '요청이 실패했습니다');
  }
}

/** 하나의 사용자 행동마다 하나. 같은 버튼을 두 번 눌러도 같은 키면 한 번만 처리된다. */
export function actionKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 64);
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK', detail: '콘솔 서버에 연결할 수 없습니다.' });
  }
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const p = (body ?? {}) as Partial<Problem>;
    throw new ApiError({
      status: res.status,
      code: p.code ?? 'ERROR',
      ...(p.title ? { title: p.title } : {}),
      ...(p.detail ? { detail: p.detail } : {}),
      ...(p.traceId ? { traceId: p.traceId } : {}),
    });
  }
  return body as T;
}

export function adminGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  return request<T>(`/api/admin/${path}${qs ? `?${qs}` : ''}`);
}

/**
 * 상태를 바꾸는 요청. `key` 는 호출하는 쪽이 행동 단위로 만들어 넘긴다 —
 * 재시도할 때 같은 키를 써야 중복 처리가 막힌다.
 */
export function adminPost<T>(path: string, body: unknown, key: string): Promise<T> {
  return request<T>(`/api/admin/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      // 다른 사이트의 폼이나 단순 요청은 이 헤더를 붙일 수 없다. 콘솔 서버가 확인한다.
      'x-requested-with': 'wonseoro-admin',
    },
    body: JSON.stringify(body ?? {}),
  });
}

/** 지금 담당자와, 개발용 담당자 지정이 켜져 있는지. 꺼져 있으면 담당자는 관리자 로그인(T-M5-10)으로만 정해진다. */
export async function getSession(): Promise<{ operator: string | null; devOperator: boolean }> {
  const r = await request<{ operator: string | null; devOperator?: boolean }>('/api/session');
  return { operator: r.operator, devOperator: r.devOperator === true };
}

export async function setOperator(operator: string): Promise<string> {
  const r = await request<{ operator: string }>('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'wonseoro-admin' },
    body: JSON.stringify({ operator }),
  });
  return r.operator;
}

export async function clearOperator(): Promise<void> {
  await request('/api/session', { method: 'DELETE' });
}

export interface Cycle {
  id: string;
  name: string;
  admissionYear: number;
  closesAt: string;
}

export function currentCycle(): Promise<Cycle> {
  return request<Cycle>('/api/public/cycle');
}

/** 저장은 UTC, 표시만 한국 시간. 초는 보이지 않는다 — 운영자가 읽을 단위가 아니다. */
export function kst(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 오류를 운영자가 읽을 한 줄로. 추적번호가 있으면 함께 — 문의할 때 그대로 전달한다. */
export function describe(err: unknown): string {
  if (err instanceof ApiError) {
    // 운영 API 의 업무 오류 설명은 담당자에게 쓰인 말이다(서버 문구 검사). 프로토콜·내부 오류는 정해 둔 문구로 —
    // 상태 번호("요청 실패 (500)")를 보이지 않는다 (T-M5-52)
    const code = err.problem.code;
    const protocol = PROTOCOL_CODES.includes(code) || !err.problem.detail;
    const base = protocol ? problemText(err.problem).detail : err.problem.detail!;
    return err.problem.traceId ? `${base} (요청번호 ${err.problem.traceId})` : base;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

const PROTOCOL_CODES: readonly string[] = ['IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'INTERNAL', 'ERROR'];
