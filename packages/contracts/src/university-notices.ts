/**
 * 대학 고지 — 개인정보 처리방침·위탁 공개·보호책임자·문의처(문서 10 G-6), 전형료 반환 안내(G-4). 대장 D-80.
 *
 * 값은 대학마다 다르고 법무·입학처가 정한다 — 전형 설정(`notices`)에 넣어 2인 승인으로 적용한다.
 * 화면은 값이 있을 때만 그린다. 지어낸 연락처·문안을 넣지 않는다(문서 08 결정 12).
 */
export interface UniversityNotices {
  /** 개인정보 처리방침 주소(https) — 개인정보 보호법 제30조, 늘 게재 */
  privacyPolicyUrl?: string;
  /** 개인정보 처리 위탁(수탁자) 공개 주소(https) — 제26조 ②. 처리방침 안에 있으면 같은 주소 */
  processorsUrl?: string;
  /** 개인정보 보호책임자 또는 담당 부서·연락처 — 시행령 제31조 ① */
  privacyOfficer?: string;
  /** 입학처 문의처 */
  contact?: string;
  /** 전형료 반환 사유·금액·방법 — 고등교육법 시행령 제42조의3, 응시원서에 구체적으로 */
  feeRefund?: string;
}

export const UNIVERSITY_NOTICE_KEYS = ['privacyPolicyUrl', 'processorsUrl', 'privacyOfficer', 'contact', 'feeRefund'] as const;
export type UniversityNoticeKey = (typeof UNIVERSITY_NOTICE_KEYS)[number];

/** 고지마다 받는 글자 수 상한 */
export const UNIVERSITY_NOTICE_MAX: Record<UniversityNoticeKey, number> = {
  privacyPolicyUrl: 500,
  processorsUrl: 500,
  privacyOfficer: 200,
  contact: 200,
  feeRefund: 2000,
};

/** 주소 고지 — https 만(지원자를 평문 주소로 보내지 않는다) */
export const UNIVERSITY_NOTICE_URL_KEYS: readonly UniversityNoticeKey[] = ['privacyPolicyUrl', 'processorsUrl'];

/** 운영 전에 반드시 있어야 하는 고지 — 없으면 설정 검사가 경고한다 */
export const UNIVERSITY_NOTICE_REQUIRED: readonly UniversityNoticeKey[] = ['privacyPolicyUrl', 'privacyOfficer', 'feeRefund'];

/** 설정 값에서 알려진 고지만, 문자열만 꺼낸다 — 공개 응답에 다른 키가 섞이지 않게 */
export function pickUniversityNotices(value: unknown): UniversityNotices {
  const out: UniversityNotices = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of UNIVERSITY_NOTICE_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out;
}
