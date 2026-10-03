'use client';

import { OIDC_MODE, logout, refresh, signedIn } from './auth';

/**
 * 화면 세션 — 무활동 만료·경고(T-M5-45)와, 지금 작성 중인 원서.
 *
 * 본인확인(OIDC, T-M5-02 단계 6) 모드 — 신원은 이 탭의 로그인 토큰(lib/auth.ts)이고 API 호출 계층이 붙인다. 화면 세션의
 * 지원자 식별자·가명 토큰 자리에는 자리표시자(`OIDC_SESSION`)만 둔다 — 지원자 식별자는 서버가 토큰으로 정한다.
 * 연장은 토큰 갱신도 함께 해 발급자의 무활동 시간을 뒤로 밀고, 세션이 끝나면 갱신 토큰을 폐기한다(공용 PC).
 *
 * 개발 모드 — 브라우저 저장소에 지원자 식별자와 중앙 가명 토큰을 둔다.
 *
 * 가명 토큰은 **지어내지 않는다.** 전에는 화면이 `subj-<식별자 앞 8자>` 를 만들어 썼는데, 대학 DB 에
 * 등록된 토큰과 달라 "내 원서" 가 늘 비어 있었고 공통원서도 엉뚱한 토큰으로 조회했다. 지금은
 * 등록된 값을 입력받고, 대학 서버가 등록값과 다르면 거절한다(403).
 *
 * 전형·모집단위 식별자는 여기 두지 않는다. 대학 카탈로그 API 에서 읽는다 —
 * 화면에 박아두면 대학이 전형을 늘릴 때마다 프론트를 고쳐야 한다. (v1.1 §A5)
 */

export interface Session {
  applicantId: string;
  subjectToken: string;
  applicationId?: string;
  /** 이 시각이 지나면 세션이 끝난다. 신원을 실은 요청이 성공할 때마다 뒤로 민다 (T-M5-45) */
  expiresAt?: string;
}

const KEY = 'wonseoro.dev.session';

/** 본인확인 모드의 자리표시자 — 화면이 "세션이 있다" 를 판단하는 데만 쓴다. API 에는 보내지 않는다 */
export const OIDC_SESSION = 'oidc';

/**
 * 세션 유지 시간 — 아무 동작(서버 요청) 없이 30분이 지나면 끝난다. 공용 PC 에 남은 개인정보를 지키려는 것이다.
 * 끝나기 5분 전에 알리고 연장할 수 있게 한다(KWCAG 시간 조절 — 20초 이상 여유, 간단한 동작으로 연장).
 * 본인확인(T-M5-02)이 붙으면 만료 시각은 인증 세션에서 받고, 연장은 세션 갱신을 부른다 — 바꿀 곳은 이 파일이다.
 */
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_WARN_MS = 5 * 60_000;
/** 세션이 바뀌면(연장·종료) 알린다 — 경고 대화상자가 듣는다 */
export const SESSION_EVENT = 'wonseoro:session';
/** 곧 끝난다·끝났다 — 작성 화면은 이 때 바로 저장한다. 입력을 잃기 전에 (T-M5-45) */
export const SESSION_EXPIRING_EVENT = 'wonseoro:session-expiring';

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...s, expiresAt: new Date(Date.now() + SESSION_IDLE_MS).toISOString() }));
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* 저장이 안 돼도 흐름은 계속된다 */
  }
}

/** 지원자가 "계속 이용하기" 를 눌렀다 — 만료를 뒤로 민다. 세션이 없거나 이미 끝났으면 아무것도 하지 않는다. */
export function extendSession(): void {
  const s = loadSession();
  if (!s) return;
  saveSession(s);
  // 본인확인 모드: 발급자의 무활동 시간도 함께 민다. 발급자가 세션을 끝냈으면(갱신 실패) 화면 세션도 끝낸다
  if (OIDC_MODE) void refresh().then((t) => t === null && expireNow());
}

/**
 * 서버가 로그인이 끝났다고 답했다(발급자 세션 만료·폐기) — 화면 세션의 끝을 지금으로 당긴다.
 * 세션 경고 대화상자가 다음 틱에 끝난 것으로 보고 마지막 저장·종료 안내를 그대로 한다.
 */
export function expireNow(): void {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.setItem(KEY, JSON.stringify({ ...(JSON.parse(raw) as Session), expiresAt: new Date().toISOString() }));
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* 저장소를 쓸 수 없으면 세션도 없다 */
  }
}

/**
 * 서버 요청이 성공했다 — 쓰고 있다는 뜻이라 만료를 뒤로 민다. 단 경고가 뜬 뒤에는 밀지 않는다:
 * 경고 순간의 저장·서류 검사 확인 같은 화면이 스스로 보낸 요청이 경고를 말없이 닫으면 안 된다.
 * 경고 뒤 연장은 지원자가 직접 누를 때만이다 (T-M5-45).
 */
export function touchSession(): void {
  const at = sessionExpiresAt();
  if (at !== null && at - Date.now() > SESSION_WARN_MS) extendSession();
}

/** 세션을 끝낸다 — 시간이 다 됐거나 지원자가 "지금 종료" 를 눌렀다. 본인확인 모드면 로그인도 끝낸다(갱신 토큰 폐기) */
export function endSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* 저장소를 쓸 수 없으면 세션도 없다 */
  }
  // 끝나는 순간 작성 화면이 마지막 저장을 보낸다(SESSION_EXPIRING_EVENT) — 그 요청이 토큰을 쓰고 끝날 시간을 두고 폐기한다.
  // 화면 세션은 이미 지웠으므로 새 요청은 나가지 않는다
  if (OIDC_MODE) setTimeout(() => void logout(false), 5_000);
}

/** 세션이 끝나는 시각(밀리초). 세션이 없으면 null. 만료 시각이 없는 옛 세션은 지금부터 센다. */
export function sessionExpiresAt(): number | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.expiresAt) {
      saveSession(s);
      return Date.now() + SESSION_IDLE_MS;
    }
    return Date.parse(s.expiresAt);
  } catch {
    return null;
  }
}

/**
 * 이 기기에서 마지막으로 저장에 성공한 시각. 대학 서버에 처음부터 닿지 못하면 서버의 마지막 저장 시각을
 * 읽을 수 없다 — 그때 장애 안내가 "마지막 저장" 을 비워 두지 않게 한다 (T-M5-55, U-8).
 */
export function rememberSaved(applicationId: string, at: string): void {
  try {
    sessionStorage.setItem(`wonseoro.saved.${applicationId}`, at);
  } catch {
    /* 저장이 안 돼도 흐름은 계속된다 */
  }
}

export function lastSavedHere(applicationId: string): string | null {
  try {
    return sessionStorage.getItem(`wonseoro.saved.${applicationId}`);
  } catch {
    return null;
  }
}

/** 만료와 상관없이 저장된 세션 — 끝나는 순간 어느 원서였는지 알려고 쓴다 */
export function peekSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** 지금 세션. 만료 시각이 지났으면 없는 것으로 본다 — 끝난 세션의 신원으로 요청하지 않는다. */
export function loadSession(): Session | null {
  // 본인확인 모드: 이 탭에 로그인이 없으면 세션도 없다
  if (OIDC_MODE && !signedIn()) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
