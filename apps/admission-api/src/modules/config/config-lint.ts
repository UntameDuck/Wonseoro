import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  COMMON_PROFILE_CODES,
  CONSENT_CODE,
  CONSENT_LIMITS,
  RESERVED_CONSENT_CODES,
  SENSITIVE_DOCUMENT_HINT,
  UNIVERSITY_NOTICE_KEYS,
  UNIVERSITY_NOTICE_MAX,
  UNIVERSITY_NOTICE_REQUIRED,
  UNIVERSITY_NOTICE_URL_KEYS,
} from '@wonseoro/contracts';
import { LEGACY_PROFILE_FIELDS } from './form-schema.service';

/**
 * Config Linter — 기술설계서 v1.1 §01 A5 "Config Linter · Compatibility Test"
 *
 * 전형 설정은 2인 승인을 거쳐 적용된다. 그런데 승인자는 JSON Schema 가 **컴파일되는지** 눈으로
 * 알 수 없다. 깨진 양식이 승인·적용되면 그 전형의 모든 저장·검증·결제가 503 으로 멈춘다
 * (FormSchemaService 가 컴파일하다 실패한다). 마감 직전이면 되돌리는 동안 접수가 멈춘다.
 * 그래서 초안을 만들 때 런타임과 **같은 엔진(Ajv)** 으로 미리 컴파일한다.
 *
 *   오류(errors)   초안을 만들지 않는다 — 적용하면 런타임이 실패하는 것들
 *   경고(warnings) 초안은 만들되 승인 화면(Diff)에 보인다 — 동작은 하지만 의도와 다를 수 있는 것들
 *
 * 설정 키
 *   forms[전형코드]               추가문항 JSON Schema. 속성에 `"x-profile": true` 를 달면 공통원서에서 가져온다
 *   requiredDocuments[전형코드]   접수 전 검사를 통과해야 하는 서류 종류
 *   optionalDocuments[전형코드]   받되 요구하지 않는 서류 종류
 *   documentLabels[서류종류]      화면에 보일 서류 이름
 *   consents                      원서 동의 문안 — 코드·제목·전문·필수 여부·판 (문서 10 G-2·G-11, D-81)
 *   notices                       지원자 고지 — 처리방침·위탁·보호책임자·문의처 주소/문구, 전형료 반환 안내 (문서 10 G-4·G-6, D-80)
 *   sensitiveDocuments[서류종류]  민감정보 서류 → 올리기 전에 받을 별도 동의 코드(consents 에 문안) (문서 10 G-8, D-85)
 *   retention                     보존 정책 — 따로 검사한다(validateRetention)
 */
export interface ConfigLintResult {
  errors: string[];
  warnings: string[];
}

/** application_field_value.field_code varchar(128). 경로·특수문자를 막는다. */
const FIELD_CODE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
/** 자기소개서류 항목 — 항목 코드나 이름으로 찾는다 */
const SELF_INTRO = /자기\s*소개|자소서|self[\s_-]*intro|personal[\s_-]*statement/i;
/** document.document_type varchar(64). */
const DOCUMENT_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;

function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param typeCodes 이 모집 주기의 전형 코드. 모르면 null — 그때는 전형 코드 대조를 건너뛴다.
 */
export function lintConfig(config: unknown, typeCodes: readonly string[] | null): ConfigLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(config)) return { errors: ['설정은 JSON 객체여야 합니다.'], warnings };

  const known = typeCodes ? new Set(typeCodes) : null;
  const unknownType = (where: string, code: string) => {
    if (known && !known.has(code)) warnings.push(`${where}.${code}: 이 모집에 없는 전형 코드입니다.`);
  };

  // ── forms ───────────────────────────────────────────────────────────
  if (config.forms !== undefined) {
    if (!isObject(config.forms)) {
      errors.push('forms 는 전형 코드별 JSON Schema 객체여야 합니다.');
    } else {
      // 런타임(FormSchemaService)과 같은 옵션으로 컴파일한다. 다른 옵션이면 여기서 통과하고 런타임에서 깨진다.
      const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
      addFormats(ajv);
      for (const [code, form] of Object.entries(config.forms)) {
        const at = `forms.${code}`;
        unknownType('forms', code);
        if (!isObject(form)) {
          errors.push(`${at}: JSON Schema 객체여야 합니다.`);
          continue;
        }
        if (form.type !== undefined && form.type !== 'object') {
          errors.push(`${at}.type: 원서 양식은 object 여야 합니다.`);
        }
        const properties = form.properties ?? {};
        if (!isObject(properties)) {
          errors.push(`${at}.properties: 항목 정의 객체여야 합니다.`);
          continue;
        }
        for (const field of Object.keys(properties)) {
          if (!FIELD_CODE.test(field)) {
            errors.push(`${at}.properties.${field}: 항목 코드는 영문으로 시작하는 영문·숫자·_ 128자 이하여야 합니다.`);
          }
        }
        if (form.required !== undefined) {
          if (!Array.isArray(form.required) || form.required.some((r) => typeof r !== 'string')) {
            errors.push(`${at}.required: 항목 코드 배열이어야 합니다.`);
          } else {
            for (const r of form.required as string[]) {
              if (!(r in properties)) errors.push(`${at}.required: 정의되지 않은 항목 ${r} 을 필수로 요구합니다.`);
            }
          }
        }
        try {
          ajv.compile(form);
        } catch (err) {
          errors.push(`${at}: JSON Schema 를 컴파일할 수 없습니다 — ${(err as Error).message}`);
        }
        const untitled = Object.entries(properties)
          .filter(([, p]) => isObject(p) && (typeof p.title !== 'string' || p.title.trim() === ''))
          .map(([field]) => field);
        // 이름이 없으면 화면이 항목 코드를 라벨로 보인다 — 지원자가 읽을 수 없는 칸이다. 새 초안은 거절한다(T-M5-51, U-29).
        // 이미 적용된 설정은 그대로 동작한다 — 이 검사는 초안을 만들 때 돈다.
        if (untitled.length > 0) {
          errors.push(`${at}: 이름(title)이 없는 항목이 있습니다. 지원자 화면에 항목 이름으로 보일 title 을 넣어 주십시오 — ${untitled.join(', ')}`);
        }
        // 자기소개서는 대입 전형에서 받지 않는다(고등교육법 시행령 제35조 ①, 문서 10 G-1). 예외 전형(재외국민 등)이 있어
        // 거절하지 않고 경고로 승인 화면에 보인다 — 승인자가 근거를 확인하고 승인한다
        const selfIntro = Object.entries(properties)
          .filter(([field, p]) => SELF_INTRO.test(field) || (isObject(p) && typeof p.title === 'string' && SELF_INTRO.test(p.title)))
          .map(([field, p]) => (isObject(p) && typeof p.title === 'string' && p.title.trim() ? p.title.trim() : field));
        if (selfIntro.length > 0) {
          warnings.push(
            `${at}: 자기소개서로 보이는 항목이 있습니다. 대입 전형은 자기소개서를 받지 않습니다(고등교육법 시행령 제35조) — 법령상 예외 전형이 아니면 빼 주십시오 — ${selfIntro.join(', ')}`,
          );
        }
        const offStandard = Object.entries(properties)
          .filter(([field, p]) => isObject(p) && p['x-profile'] === true && !COMMON_PROFILE_CODES.includes(field))
          .map(([field]) => field);
        if (offStandard.length > 0) {
          warnings.push(`${at}: 공통원서 표준에 없는 항목은 Vault 에서 가져올 수 없습니다 — ${offStandard.join(', ')}`);
        }
        const marked = Object.values(properties).some((p) => isObject(p) && p['x-profile'] === true);
        const legacy = LEGACY_PROFILE_FIELDS.filter((f) => f in properties);
        if (!marked && legacy.length > 0) {
          warnings.push(
            `${at}: 공통원서 항목 표시("x-profile": true)가 없어 옛 기본값(${legacy.join(', ')})을 공통원서에서 가져옵니다.`,
          );
        }
      }
    }
  }

  // ── documents ───────────────────────────────────────────────────────
  for (const key of ['requiredDocuments', 'optionalDocuments'] as const) {
    const docs = config[key];
    if (docs === undefined) continue;
    if (!isObject(docs)) {
      errors.push(`${key} 는 전형 코드별 서류 종류 배열이어야 합니다.`);
      continue;
    }
    for (const [code, list] of Object.entries(docs)) {
      unknownType(key, code);
      if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) {
        errors.push(`${key}.${code}: 서류 종류 배열이어야 합니다.`);
        continue;
      }
      for (const t of list as string[]) {
        if (!DOCUMENT_TYPE.test(t)) {
          errors.push(`${key}.${code}: 서류 종류 ${t} 는 대문자·숫자·_ 64자 이하여야 합니다.`);
        }
      }
    }
  }
  // ── consents ────────────────────────────────────────────────────────
  // 원서 수집·이용 동의는 법정 절차다(보호법 제15·22조). 없으면 경고, 형식이 틀리면 거절 (D-81)
  if (config.consents === undefined) {
    warnings.push('consents: 원서 동의 문안이 없습니다 — 지원자에게 개인정보 수집·이용 동의를 받지 않습니다.');
  } else if (!Array.isArray(config.consents)) {
    errors.push('consents 는 동의 문안 배열이어야 합니다.');
  } else {
    const seen = new Set<string>();
    config.consents.forEach((c, i) => {
      const at = `consents[${i}]`;
      if (!isObject(c)) {
        errors.push(`${at}: 동의 문안 객체여야 합니다.`);
        return;
      }
      if (typeof c.code !== 'string' || !CONSENT_CODE.test(c.code)) {
        errors.push(`${at}.code: 대문자로 시작하는 대문자·숫자·_ 64자 이하여야 합니다.`);
      } else if (RESERVED_CONSENT_CODES.includes(c.code)) {
        errors.push(`${at}.code: ${c.code} 는 공통원서 제공 기록이 쓰는 코드입니다.`);
      } else if (seen.has(c.code)) {
        errors.push(`${at}.code: ${c.code} 가 두 번 나옵니다.`);
      } else {
        seen.add(c.code);
      }
      for (const key of ['title', 'text', 'version'] as const) {
        const v = c[key];
        if (typeof v !== 'string' || !v.trim()) errors.push(`${at}.${key}: 비어 있지 않은 문구여야 합니다.`);
        else if (v.length > CONSENT_LIMITS[key]) errors.push(`${at}.${key}: ${CONSENT_LIMITS[key]}자 이하로 적어 주십시오.`);
      }
      if (c.required !== undefined && typeof c.required !== 'boolean') errors.push(`${at}.required: 참/거짓이어야 합니다.`);
    });
    if (!config.consents.some((c) => isObject(c) && c.required === true)) {
      warnings.push('consents: 필수 동의가 없습니다 — 개인정보 수집·이용 동의는 원서 접수에 필요한 필수 동의입니다.');
    }
  }

  // ── notices ─────────────────────────────────────────────────────────
  // 처리방침·보호책임자·전형료 반환 안내는 법정 고지다. 없어도 접수는 돌지만 지원자에게 알릴 길이 없다 —
  // 승인 화면에 경고로 보인다. 값이 있으면 형식을 지켜야 한다(오류) (D-80)
  if (config.notices === undefined) {
    warnings.push('notices: 지원자 고지가 없습니다 — 개인정보 처리방침·보호책임자·전형료 반환 안내가 지원자 화면에 나오지 않습니다.');
  } else if (!isObject(config.notices)) {
    errors.push('notices 는 고지 이름별 문구 객체여야 합니다.');
  } else {
    const notices = config.notices;
    for (const [key, value] of Object.entries(notices)) {
      if (!(UNIVERSITY_NOTICE_KEYS as readonly string[]).includes(key)) {
        warnings.push(`notices.${key}: 알 수 없는 고지입니다. 지원자 화면에 나오지 않습니다.`);
        continue;
      }
      const k = key as (typeof UNIVERSITY_NOTICE_KEYS)[number];
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(`notices.${key}: 비어 있지 않은 문구여야 합니다.`);
        continue;
      }
      if (value.length > UNIVERSITY_NOTICE_MAX[k]) {
        errors.push(`notices.${key}: ${UNIVERSITY_NOTICE_MAX[k]}자 이하로 적어 주십시오.`);
      }
      if (UNIVERSITY_NOTICE_URL_KEYS.includes(k) && !isHttpsUrl(value.trim())) {
        errors.push(`notices.${key}: https 로 시작하는 주소여야 합니다.`);
      }
    }
    const missing = UNIVERSITY_NOTICE_REQUIRED.filter((k) => typeof notices[k] !== 'string' || !(notices[k] as string).trim());
    if (missing.length > 0) {
      warnings.push(`notices: 법정 고지가 빠졌습니다 — ${missing.join(', ')}`);
    }
  }
  if (config.documentLabels !== undefined) {
    if (!isObject(config.documentLabels) || Object.values(config.documentLabels).some((v) => typeof v !== 'string')) {
      errors.push('documentLabels 는 서류 종류별 이름(문자열) 객체여야 합니다.');
    }
  }

  // ── sensitiveDocuments ──────────────────────────────────────────────
  // 장애·건강 서류는 민감정보다 — 다른 개인정보와 별도로 동의를 받아야 한다(보호법 제23조 ① 1, D-85).
  // 가리키는 동의가 없으면 그 서류를 아무도 올릴 수 없다 → 거절. 민감해 보이는데 표시가 없으면 경고
  const consentList = Array.isArray(config.consents) ? config.consents.filter(isObject) : [];
  const usedTypes = new Set<string>();
  for (const key of ['requiredDocuments', 'optionalDocuments'] as const) {
    const docs = config[key];
    if (isObject(docs)) for (const list of Object.values(docs)) if (Array.isArray(list)) list.forEach((t) => typeof t === 'string' && usedTypes.add(t));
  }
  const sensitive = config.sensitiveDocuments;
  if (sensitive !== undefined) {
    if (!isObject(sensitive)) {
      errors.push('sensitiveDocuments 는 서류 종류별 별도 동의 코드 객체여야 합니다.');
    } else {
      for (const [type, code] of Object.entries(sensitive)) {
        const at = `sensitiveDocuments.${type}`;
        if (!DOCUMENT_TYPE.test(type)) errors.push(`${at}: 서류 종류는 대문자·숫자·_ 64자 이하여야 합니다.`);
        if (typeof code !== 'string' || !CONSENT_CODE.test(code)) {
          errors.push(`${at}: 별도 동의 코드(대문자·숫자·_)여야 합니다.`);
          continue;
        }
        const consent = consentList.find((c) => c.code === code);
        if (!consent) {
          errors.push(`${at}: 별도 동의 ${code} 의 문안이 consents 에 없습니다 — 이 서류를 아무도 올릴 수 없습니다.`);
        } else if (consent.required === true) {
          warnings.push(`${at}: 별도 동의 ${code} 가 필수로 되어 있습니다 — 민감정보 동의는 이 서류를 내는 지원자에게만 받습니다. 필수를 풀어 주십시오.`);
        }
        if (!usedTypes.has(type)) warnings.push(`${at}: 어느 전형도 받지 않는 서류입니다.`);
      }
    }
  }
  const marked = isObject(sensitive) ? new Set(Object.keys(sensitive)) : new Set<string>();
  const labels = isObject(config.documentLabels) ? config.documentLabels : {};
  const looksSensitive = [...usedTypes]
    .filter((t) => !marked.has(t) && (SENSITIVE_DOCUMENT_HINT.test(t) || (typeof labels[t] === 'string' && SENSITIVE_DOCUMENT_HINT.test(labels[t] as string))))
    .map((t) => (typeof labels[t] === 'string' ? `${labels[t]}(${t})` : t));
  if (looksSensitive.length > 0) {
    warnings.push(
      `sensitiveDocuments: 장애·건강 정보를 담은 서류로 보입니다 — 민감정보라 별도 동의가 필요합니다(개인정보 보호법 제23조). 민감정보 서류가 맞으면 별도 동의를 지정해 주십시오 — ${looksSensitive.join(', ')}`,
    );
  }

  return { errors, warnings };
}
