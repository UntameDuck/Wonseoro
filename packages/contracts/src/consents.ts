/**
 * 원서 동의 — 개인정보 수집·이용(보호법 제15·22조), 학생부·수능 온라인 제공 안내(초·중등교육법 제30조의6) 등.
 * 문서 10 G-2·G-11, 대장 D-81.
 *
 * 문안은 대학마다 다르고 법무·입학처가 정한다 — 전형 설정(`consents`)에 넣어 2인 승인으로 적용한다.
 * 지원자의 동의는 원서마다 `consent_record` 에 남는다 — 그때 본 문안의 판(version)과 문안 해시까지.
 */
export interface ApplicationConsent {
  /** 동의 코드 — 대문자·숫자·_ */
  code: string;
  /** 화면 제목 — "개인정보 수집·이용 동의(필수)" 의 앞부분 */
  title: string;
  /** 전문 — 목적·항목·보유기간·거부권과 거부 시 불이익 */
  text: string;
  /** 필수 동의 — 없으면 접수할 수 없다(검증 오류·결제 전 확인) */
  required: boolean;
  /** 문안 판 — 문안을 고치면 올린다. 동의 기록이 어느 판에 대한 것인지 남는다 */
  version: string;
}

export const CONSENT_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** 공통원서 제공 기록이 쓰는 코드 — 설정이 쓰지 못한다 */
export const RESERVED_CONSENT_CODES: readonly string[] = ['PROFILE_SNAPSHOT'];
export const CONSENT_LIMITS = { title: 100, text: 4000, version: 32 } as const;

/** 설정 값에서 형식이 맞는 동의만 꺼낸다 — 설정 검사를 통과한 값이면 전부 */
export function pickConsents(value: unknown): ApplicationConsent[] {
  if (!Array.isArray(value)) return [];
  const out: ApplicationConsent[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    if (
      typeof c.code === 'string' && CONSENT_CODE.test(c.code) && !RESERVED_CONSENT_CODES.includes(c.code) &&
      typeof c.title === 'string' && c.title.trim() &&
      typeof c.text === 'string' && c.text.trim() &&
      typeof c.version === 'string' && c.version.trim()
    ) {
      out.push({ code: c.code, title: c.title.trim(), text: c.text, required: c.required === true, version: c.version.trim() });
    }
  }
  return out;
}
