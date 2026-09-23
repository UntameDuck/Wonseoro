'use client';

/**
 * 개발용 세션.
 * 브라우저 저장소에 지원자 식별자를 둔다. M5 에서 서버 세션으로 교체한다. (T-M5-02)
 *
 * 전형·모집단위 식별자는 여기 두지 않는다. 대학 카탈로그 API 에서 읽는다 —
 * 화면에 박아두면 대학이 전형을 늘릴 때마다 프론트를 고쳐야 한다. (v1.1 §A5)
 */

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
