import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { COMMON_PROFILE_CODES } from '@wonseoro/contracts';
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
 *   retention                     보존 정책 — 따로 검사한다(validateRetention)
 */
export interface ConfigLintResult {
  errors: string[];
  warnings: string[];
}

/** application_field_value.field_code varchar(128). 경로·특수문자를 막는다. */
const FIELD_CODE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
/** document.document_type varchar(64). */
const DOCUMENT_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;

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
  if (config.documentLabels !== undefined) {
    if (!isObject(config.documentLabels) || Object.values(config.documentLabels).some((v) => typeof v !== 'string')) {
      errors.push('documentLabels 는 서류 종류별 이름(문자열) 객체여야 합니다.');
    }
  }

  return { errors, warnings };
}
