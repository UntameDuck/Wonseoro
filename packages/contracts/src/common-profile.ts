/**
 * 공통원서 표준 항목 — 기술설계서 v1.0 §5 · v1.1 §10 §3 (D-57)
 *
 * 공통원서는 지원자가 **한 번** 쓰고 여러 대학이 동의 범위 안에서 가져가는 정보다.
 * 대학마다 다른 추가문항(config `forms`)과 달리 **플랫폼 표준**이라 한 곳에 둔다 —
 *   - 중앙 Vault 는 이 항목만 저장한다 (표준에 없는 항목은 거절)
 *   - 지원자 웹의 공통원서 화면은 이 목록으로 그린다
 *   - 대학 설정 검사(config-lint)는 `x-profile` 항목이 여기 있는지 본다 — 없으면 Vault 에서 올 수 없다
 *
 * 항목을 늘리는 것은 호환 변경이다(대학이 가져가지 않으면 그만). 줄이거나 형식을 바꾸는 것은
 * 이미 동의·저장된 값과 어긋나므로 계약 변경 절차를 탄다 (§A16).
 */
export interface CommonProfileField {
  code: string;
  title: string;
  type: 'string' | 'integer';
  format?: 'email' | 'tel';
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export const COMMON_PROFILE_FIELDS: readonly CommonProfileField[] = [
  { code: 'highSchool', title: '출신 고등학교', type: 'string', maxLength: 100 },
  { code: 'graduationYear', title: '졸업(예정) 연도', type: 'integer', minimum: 1990, maximum: 2100 },
  { code: 'contactEmail', title: '이메일', type: 'string', format: 'email', maxLength: 254 },
  { code: 'phone', title: '휴대전화', type: 'string', format: 'tel', maxLength: 20 },
];

export const COMMON_PROFILE_CODES: readonly string[] = COMMON_PROFILE_FIELDS.map((f) => f.code);

/** 값이 표준 형식에 맞는지. 맞지 않으면 사람이 읽을 이유, 맞으면 null. */
export function commonProfileProblem(code: string, value: unknown): string | null {
  const field = COMMON_PROFILE_FIELDS.find((f) => f.code === code);
  if (!field) return `공통원서 표준에 없는 항목입니다: ${code}`;
  if (value === null) return null;
  if (field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return `${field.title}은(는) 정수여야 합니다.`;
    if (field.minimum !== undefined && value < field.minimum) return `${field.title}은(는) ${field.minimum} 이상이어야 합니다.`;
    if (field.maximum !== undefined && value > field.maximum) return `${field.title}은(는) ${field.maximum} 이하여야 합니다.`;
    return null;
  }
  if (typeof value !== 'string') return `${field.title}은(는) 문자열이어야 합니다.`;
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return `${field.title}은(는) ${field.maxLength}자를 넘을 수 없습니다.`;
  }
  if (field.format === 'email' && value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `${field.title} 형식이 올바르지 않습니다.`;
  }
  if (field.format === 'tel' && value !== '' && !/^[0-9+\-() ]{7,20}$/.test(value)) {
    return `${field.title} 형식이 올바르지 않습니다.`;
  }
  return null;
}

/**
 * 공통원서 자체의 개인정보 수집·이용 동의 — 운영기관이 처리자다(보호법 제15조, 문서 10 G-3, 대장 D-82).
 * 대학별 원서 문안(`consents`, D-81)과 달리 공통원서는 대학과 무관하게 한 곳이 받으므로 문안을 여기 둔다.
 * 문안을 고치면 판(version)을 올린다 — 저장할 때 지금 판에 동의해야 한다. 아래는 운영기관·법무가 확정할 초안이다.
 */
export const COMMON_PROFILE_COLLECTION_CONSENT = {
  version: '2026-v1',
  title: '공통원서 개인정보 수집·이용',
  text: [
    '원서로 운영기관은 여러 대학 원서에 같은 정보를 다시 입력하지 않도록 공통원서를 보관합니다.',
    '수집 항목: 출신 고등학교, 졸업(예정) 연도, 이메일, 휴대전화',
    '이용 목적: 지원자가 동의한 대학의 원서에 항목을 복사',
    '보유 기간: 지원자가 삭제를 요청할 때까지',
    '동의를 거부할 수 있습니다. 거부하면 공통원서를 쓰지 않고 대학 원서에서 직접 입력합니다.',
  ].join('\n'),
} as const;
