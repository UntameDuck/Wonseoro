/**
 * 개인정보 최소 상담 조회 — 노션 §01 B11 "자동 증적번호, PII 최소 Support View" (T-M6-07, 대장 D-79)
 *
 * 상담원은 이름·연락처가 아니라 **접수번호** 또는 **상담 확인번호** 로 원서를 찾는다.
 * 상담 확인번호는 원서마다 대학 DB 가 만드는 10자(Crockford base32)이고, 지원자는 자기 상태 확인 화면에서 본다.
 * 조회할 때마다 증적번호(`SR-YYYYMMDD-XXXXXX`)가 생기고 그 순간 보인 내용이 그대로 남는다.
 */

/** 조회 사유 분류 — 자유 문장을 받지 않는다(상담원이 지원자 개인정보를 사유에 적지 않게) */
export const SUPPORT_REASON = ['STATUS', 'PAYMENT', 'DOCUMENT', 'INCIDENT', 'OTHER'] as const;
export type SupportReason = (typeof SUPPORT_REASON)[number];

export const SUPPORT_REASON_LABEL: Record<SupportReason, string> = {
  STATUS: '접수 여부 문의',
  PAYMENT: '결제 문의',
  DOCUMENT: '서류 문의',
  INCIDENT: '장애 중 문의',
  OTHER: '그 밖의 문의',
};

export type SupportLookupKind = 'APPLICATION_NUMBER' | 'SUPPORT_CODE';

export const SUPPORT_LOOKUP_KIND_LABEL: Record<SupportLookupKind, string> = {
  APPLICATION_NUMBER: '접수번호',
  SUPPORT_CODE: '상담 확인번호',
};

/** Crockford base32 — 헷갈리는 I·L·O·U 를 쓰지 않는다 */
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * 사람이 불러 준 상담 확인번호를 저장된 모양으로 — 대문자, 띄어쓰기·하이픈 제거, 헷갈리는 글자 바로잡기(O→0, I·L→1).
 * 형식이 아니면 null.
 */
export function normalizeSupportCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CROCKFORD.test(raw) ? raw : null;
}

/** 화면 표기 — 다섯 자씩 끊어 `XXXXX-XXXXX` */
export function formatSupportCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** 증적번호 형식 */
export const SUPPORT_EVIDENCE_NUMBER = /^SR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$/;
