/**
 * Retention Matrix — 기술설계서 v1.1 §01 A15, v1.0 §9 · §2.2 (T-M3-10)
 *
 * §A15: 데이터 종류별 Retention Matrix. 대학별 정책을 설정하되
 *       **법정·기관 기준보다 짧게 설정할 수 없도록** Policy Validation.
 * v1.0 §9: 업무 원서 데이터의 보존기간은 각 대학 개인정보처리방침·입시업무 규정에 따른다.
 *
 * **법정 기간을 지어내지 않는다.**
 * 설계서가 숫자로 준 기준은 하나다 — 개인정보 관리자 접속기록 2년 이상 (v1.0 §2.2,
 * 개인정보의 안전성 확보조치 기준 제8조). 나머지는 "대학 규정에 따른다" 뿐이다.
 * 여기서 그럴듯한 숫자를 박으면, 틀렸을 때 **플랫폼이 법보다 짧은 보존을 강제**하게 된다.
 * 그래서 근거 없는 항목은 하한을 두지 않되 **대학이 반드시 명시**하게 한다.
 * 빠진 항목을 기본값으로 채우지 않는다 — 조용한 기본값이 곧 조용한 파기다. (D-38)
 */

export type RetentionAnchor =
  /** 모집(cycle)이 마감된 때부터 센다. 원서 데이터는 모집 단위로 끝난다. */
  | 'CYCLE_CLOSED'
  /** 기록이 생긴 때부터 센다. 접속기록처럼 사건 단위인 것. */
  | 'EVENT_TIME';

export type RetentionFloor =
  /** 법령 근거가 있는 하한. 이보다 짧게 정할 수 없다. */
  | { kind: 'LEGAL'; days: number; basis: string }
  /** 플랫폼이 아는 숫자가 없다. 대학 규정에 따르되 **반드시 명시**해야 한다. */
  | { kind: 'INSTITUTION'; basis: string }
  /** 보존기간을 정할 수 없다. 지우는 경로 자체가 없어야 한다. */
  | { kind: 'IMMUTABLE'; basis: string };

/**
 * 기간이 지났을 때 무엇을 하는가.
 *   CONTENT — 행은 두고 내용(본문·PII)만 비운다. 감사 체인이 원서 행을 참조하므로
 *             행을 지우면 체인이 끊긴다 (audit_event.application_id 는 CASCADE 가 없다)
 *   OBJECT  — Object Storage 의 파일을 지운다. 해시는 DB 에 남아 "무엇이 제출됐는가" 는 증명된다
 *   NONE    — 지우지 않는다
 */
export type PurgeMode = 'CONTENT' | 'OBJECT' | 'NONE';

export interface RetentionCategory {
  label: string;
  anchor: RetentionAnchor;
  floor: RetentionFloor;
  purge: PurgeMode;
  /** 개인정보를 담는가. 동의 기록 정합성 규칙에 쓴다. */
  personal: boolean;
}

const INSTITUTION = {
  kind: 'INSTITUTION',
  basis: 'v1.0 §9 — 각 대학 개인정보처리방침·입시업무 규정',
} as const;

export const RETENTION_CATEGORIES = {
  APPLICATION_UNSUBMITTED: {
    label: '접수되지 않은 원서 (작성 중·취소·만료)',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'CONTENT',
    personal: true,
  },
  APPLICATION_SUBMITTED: {
    label: '접수된 원서 본문과 접수 원장',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'CONTENT',
    personal: true,
  },
  APPLICANT_PII: {
    label: '지원자 신원정보 (암호화 저장분)',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'CONTENT',
    personal: true,
  },
  DOCUMENT_FILE: {
    label: '제출 서류 파일',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'OBJECT',
    personal: true,
  },
  PAYMENT_RECORD: {
    label: '전형료 결제 기록',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'CONTENT',
    personal: false,
  },
  CONSENT_RECORD: {
    label: '개인정보 수집·제공 동의 기록',
    anchor: 'CYCLE_CLOSED',
    floor: INSTITUTION,
    purge: 'CONTENT',
    personal: false,
  },
  ADMIN_ACCESS_LOG: {
    label: '개인정보 관리자 접속기록',
    anchor: 'EVENT_TIME',
    floor: {
      kind: 'LEGAL',
      days: 730,
      basis: '개인정보의 안전성 확보조치 기준 제8조 — 2년 이상 (v1.0 §2.2)',
    },
    // 감사 체인 안에 있다. 기간이 지나도 체인에서 빼면 체인이 끊긴다. WORM 이관 뒤에 다룬다.
    purge: 'NONE',
    personal: false,
  },
  AUDIT_EVENT: {
    label: '감사 이벤트 (hash-chain)',
    anchor: 'EVENT_TIME',
    floor: { kind: 'IMMUTABLE', basis: 'v1.0 §9 — 운영자에게 삭제·수정 권한 없음, WORM' },
    purge: 'NONE',
    personal: false,
  },
  ACTIVATION_RECORD: {
    label: '마감·설정 적용 기록 (서명)',
    anchor: 'EVENT_TIME',
    floor: { kind: 'IMMUTABLE', basis: 'v1.1 §B17 — 불변 기록 (D-35)' },
    purge: 'NONE',
    personal: false,
  },
} as const satisfies Record<string, RetentionCategory>;

export type RetentionCategoryCode = keyof typeof RETENTION_CATEGORIES;

/** 대학이 설정하는 것. Config 의 `retention` 섹션이다. 값은 일 단위. */
export type RetentionPolicy = Partial<Record<RetentionCategoryCode, { days: number }>>;

export interface RetentionProblem {
  category: string;
  message: string;
}

/** 상한. 이보다 긴 값은 대개 단위를 착각한 것이다 (일 대신 초를 넣는 식). */
export const RETENTION_MAX_DAYS = 36_500;

/**
 * 보존 정책 검증. **문제를 전부 모아** 돌려준다 — 하나 고치고 다시 내면 또 하나가
 * 나오는 식이면 담당자는 몇 번 만에 포기하고 아무 값이나 넣는다.
 */
export function validateRetention(input: unknown): RetentionProblem[] {
  const problems: RetentionProblem[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ category: '*', message: 'retention 은 항목별 { days } 객체여야 합니다.' }];
  }
  const policy = input as Record<string, unknown>;
  const codes = Object.keys(RETENTION_CATEGORIES) as RetentionCategoryCode[];

  for (const key of Object.keys(policy)) {
    if (!(key in RETENTION_CATEGORIES)) {
      problems.push({ category: key, message: '알 수 없는 데이터 종류입니다.' });
    }
  }

  const days: Partial<Record<RetentionCategoryCode, number>> = {};
  for (const code of codes) {
    const cat: RetentionCategory = RETENTION_CATEGORIES[code];
    const entry = policy[code];

    if (cat.floor.kind === 'IMMUTABLE') {
      if (entry !== undefined) {
        problems.push({
          category: code,
          message: `보존기간을 정할 수 없는 기록입니다. 지우는 경로가 없어야 합니다. (${cat.floor.basis})`,
        });
      }
      continue;
    }

    // 빠진 항목을 기본값으로 채우지 않는다. 조용한 기본값이 곧 조용한 파기다.
    if (entry === undefined) {
      problems.push({ category: code, message: `${cat.label} 의 보존기간을 명시해야 합니다.` });
      continue;
    }
    const value = (entry as { days?: unknown } | null)?.days;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      problems.push({ category: code, message: '보존기간(days)은 1 이상의 정수여야 합니다.' });
      continue;
    }
    if (value > RETENTION_MAX_DAYS) {
      problems.push({
        category: code,
        message: `${RETENTION_MAX_DAYS}일을 넘습니다. 단위(일)를 확인해 주십시오.`,
      });
      continue;
    }
    if (cat.floor.kind === 'LEGAL' && value < cat.floor.days) {
      problems.push({
        category: code,
        message: `법정 기준 ${cat.floor.days}일보다 짧습니다. (${cat.floor.basis})`,
      });
      continue;
    }
    days[code] = value;
  }

  // ── 정합성 — 법이 아니라 증적의 구조에서 나오는 규칙 ────────────────────
  // 동의 기록은 그 동의로 처리한 데이터보다 먼저 사라지면 안 된다.
  // 데이터는 남았는데 동의 기록이 없으면, 적법하게 갖고 있다는 것을 증명하지 못한다.
  const consent = days.CONSENT_RECORD;
  if (consent !== undefined) {
    for (const code of codes) {
      const cat: RetentionCategory = RETENTION_CATEGORIES[code];
      const d = days[code];
      if (cat.personal && d !== undefined && d > consent) {
        problems.push({
          category: 'CONSENT_RECORD',
          message: `동의 기록(${consent}일)이 ${cat.label}(${d}일)보다 먼저 파기됩니다. 동의 없이 보관하는 데이터가 생깁니다.`,
        });
      }
    }
  }
  // 결제 기록은 접수 원서보다 먼저 사라지면 안 된다.
  // Evidence Package 가 결제를 잃으면 "전형료를 내고 접수했다" 를 증명하지 못한다.
  const payment = days.PAYMENT_RECORD;
  const submitted = days.APPLICATION_SUBMITTED;
  if (payment !== undefined && submitted !== undefined && payment < submitted) {
    problems.push({
      category: 'PAYMENT_RECORD',
      message: `결제 기록(${payment}일)이 접수 원서(${submitted}일)보다 먼저 파기됩니다. 접수 증적이 깨집니다.`,
    });
  }

  return problems;
}
