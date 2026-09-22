'use client';

/**
 * M2 개발용 세션.
 * 브라우저 저장소에 지원자 식별자를 둔다. M5 에서 서버 세션으로 교체한다. (T-M5-02)
 * 운영에서는 이 파일이 존재하면 안 된다.
 */
export const DEMO_CYCLE = '11111111-1111-1111-1111-111111111111';
export const DEMO_TYPE = '22222222-2222-2222-2222-222222222222';
export const DEMO_DEPARTMENT = '33333333-3333-3333-3333-333333333333';

export interface Session {
  applicantId: string;
  subjectToken: string;
  applicationId?: string;
}

const KEY = 'wonseoro.dev.session';

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장이 안 돼도 흐름은 계속된다 */
  }
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
