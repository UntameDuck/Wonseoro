import { Injectable, Logger } from '@nestjs/common';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { Db } from '@wonseoro/server-kit';
import { josa, pickSensitiveDocuments } from '@wonseoro/contracts';
import { ProblemException } from '../../common/problem/problem.exception';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** 전형이 받는 서류 한 종류. 설정(config_json)의 requiredDocuments·optionalDocuments·documentLabels 에서 온다. */
export interface DocumentSpec {
  documentType: string;
  /** 화면에 보일 이름. 설정에 없으면 서류 코드를 그대로 쓴다. */
  label: string;
  /** 접수(=결제) 전에 검사를 통과해야 하는가. */
  required: boolean;
  /** 민감정보 서류면 올리기 전에 받아야 하는 별도 동의 코드 (보호법 제23조, D-85). 아니면 없다 */
  sensitiveConsentCode?: string;
}

export interface FormSchema {
  /** config_version.version — application_field_value.schema_version 에 그대로 저장한다. */
  schemaVersion: string;
  /** 대학별 추가문항 JSON Schema. */
  schema: Record<string, unknown>;
  /**
   * 공통원서(중앙 Vault)에서 가져오는 항목. 스키마 속성에 `"x-profile": true` 를 단 것이다.
   * 원서를 만들 때 Vault 에 이 항목만 요청하고(§10 §3), 화면은 1단계(공통정보)에 그린다.
   */
  profileFields: string[];
  /** 이 전형이 받는 서류. 비어 있으면 서류를 받지 않거나 아직 정하지 않은 전형이다. */
  documents: DocumentSpec[];
}

interface ConfigJson {
  forms?: Record<string, Record<string, unknown>>;
  requiredDocuments?: Record<string, string[]>;
  optionalDocuments?: Record<string, string[]>;
  documentLabels?: Record<string, string>;
  /** 민감정보 서류 → 별도 동의 코드 (D-85) */
  sensitiveDocuments?: Record<string, string>;
}

interface ConfigRow extends Record<string, unknown> {
  version: string;
  config_json: ConfigJson;
}

/**
 * `x-profile` 표시가 하나도 없는 옛 설정(표시를 도입하기 전에 승인된 것)을 위한 기본값.
 * 스키마에 실제로 있는 속성만 남긴다 — 없는 항목을 Vault 에 요청하지 않는다.
 * 새 설정은 표시를 달고, 설정 검사(config-lint)가 표시 없는 설정에 경고를 준다.
 */
export const LEGACY_PROFILE_FIELDS = ['highSchool', 'graduationYear', 'contactEmail'] as const;

/** 스키마에서 공통원서 항목을 고른다. */
export function profileFieldsOf(schema: Record<string, unknown>): string[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const marked = Object.entries(properties)
    .filter(([, prop]) => prop?.['x-profile'] === true)
    .map(([code]) => code);
  if (marked.length > 0) return marked;
  return LEGACY_PROFILE_FIELDS.filter((code) => code in properties);
}

/** 설정에서 전형의 서류 목록을 만든다. 필수가 먼저, 같은 서류가 둘 다 있으면 필수로 본다. */
export function documentsOf(config: ConfigJson | undefined, admissionTypeCode: string): DocumentSpec[] {
  const required = config?.requiredDocuments?.[admissionTypeCode] ?? [];
  const optional = (config?.optionalDocuments?.[admissionTypeCode] ?? []).filter((t) => !required.includes(t));
  const label = (t: string) => config?.documentLabels?.[t] ?? t;
  const sensitive = pickSensitiveDocuments(config?.sensitiveDocuments);
  const spec = (t: string, req: boolean): DocumentSpec => ({
    documentType: t,
    label: label(t),
    required: req,
    ...(sensitive[t] ? { sensitiveConsentCode: sensitive[t] } : {}),
  });
  return [...required.map((t) => spec(t, true)), ...optional.map((t) => spec(t, false))];
}

/**
 * 대학별 추가문항 Schema Registry — 기술설계서 v1.1 §A5
 *
 * **대학 차이는 코드 fork 가 아니라 Configuration + JSON Schema 로 흡수한다.**
 * 대학이 늘어나도 `apps/` 아래 코드는 그대로여야 한다.
 *
 * 스키마는 config_version 테이블의 ACTIVE 버전에서 읽는다.
 * M3 에서 2인 승인·예약 활성화·rollback 이 붙어도 (T-M3-02)
 * 이 서비스의 인터페이스는 바뀌지 않는다.
 *
 * 자동저장과 최종검증의 엄격도를 다르게 둔다.
 *   자동저장(PATCH) : 부분 입력 허용. 다만 **모르는 필드는 거부**한다.
 *   최종검증(validate): required 까지 전부 확인한다.
 * 작성 중에 required 를 걸면 사용자가 한 글자도 저장할 수 없다.
 */
@Injectable()
export class FormSchemaService {
  private readonly logger = new Logger(FormSchemaService.name);
  private readonly ajv: Ajv;
  /** cycleId::admissionTypeCode → 컴파일된 검증기. 컴파일은 비싸므로 캐시한다. */
  private readonly compiled = new Map<string, { version: string; fn: ValidateFunction }>();

  constructor(private readonly db: Db) {
    this.ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
    addFormats(this.ajv);
  }

  /**
   * 활성 Config 에서 해당 전형의 추가문항 스키마를 가져온다.
   * 스키마가 없으면 추가문항이 없는 전형으로 취급한다 (빈 스키마).
   */
  async load(cycleId: string, admissionTypeCode: string): Promise<FormSchema> {
    const { rows } = await this.db.query<ConfigRow>(
      `SELECT version, config_json FROM config_version
        WHERE cycle_id = $1 AND status = 'ACTIVE'
        ORDER BY activated_at DESC NULLS LAST
        LIMIT 1`,
      [cycleId],
    );

    const row = rows[0];
    if (!row) {
      // 활성 Config 가 없으면 추가문항 없이 진행한다.
      // 운영에서는 D-1 이전에 Config 활성화가 인수 조건이다. (v1.1 §A14)
      return {
        schemaVersion: 'none',
        schema: { type: 'object', properties: {} },
        profileFields: [],
        documents: [],
      };
    }

    const schema = row.config_json?.forms?.[admissionTypeCode] ?? {
      type: 'object',
      properties: {},
    };
    return {
      schemaVersion: row.version,
      schema,
      profileFields: profileFieldsOf(schema),
      documents: documentsOf(row.config_json, admissionTypeCode),
    };
  }

  /**
   * 자동저장용 검증.
   * required 는 보지 않는다. 대신 스키마에 없는 필드는 거부한다.
   * 모르는 필드를 받아두면 나중에 최종검증에서 원인을 찾기 어려워진다.
   */
  async assertKnownFields(
    cycleId: string,
    admissionTypeCode: string,
    fields: Record<string, unknown>,
  ): Promise<string> {
    const { schemaVersion, schema } = await this.load(cycleId, admissionTypeCode);
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const known = new Set(Object.keys(properties));

    // 활성 Config 가 아예 없으면 무엇이 맞는지 알 수 없다 — 개발 DB 에서만 생기는 상황이다
    // (운영은 D-1 전 Config 활성화가 인수 조건, §A14). 활성 Config 가 있는데 이 전형에 추가문항이
    // 없으면 **어떤 항목도 받지 않는다.** 전에는 비어 있다는 이유로 아무 항목이나 받았다.
    if (schemaVersion === 'none') return schemaVersion;

    const unknown = Object.keys(fields).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      throw ProblemException.validationFailed(
        `이 전형에 없는 항목입니다: ${unknown.join(', ')}`,
      );
    }

    // 값 타입은 부분 저장이어도 확인한다.
    // 다만 "더 입력하면 충족될 수 있는" 제약은 검사하지 않는다.
    //
    // minLength 8 인 필드를 검사하면 사용자가 1자, 2자… 를 칠 때마다 저장이 실패해
    // **그 필드를 영원히 채울 수 없다.** required·minimum·pattern·format 도 같다.
    // 반대로 maxLength 초과는 더 쳐도 나아지지 않으므로 지금 막는다.
    const partial = relaxForPartialInput(schema);
    const result = this.runValidation(
      `${cycleId}::${admissionTypeCode}::partial`,
      schemaVersion,
      partial,
      fields,
    );
    if (!result.valid) {
      // 문장은 항목 이름으로 시작한다(toIssue). 경로를 앞에 붙이지 않는다 — 저장 실패 안내에 그대로 보인다.
      throw ProblemException.validationFailed(result.issues.map((i) => i.message).join(' '));
    }

    return schemaVersion;
  }

  /**
   * 최종 검증. POST /api/v1/applications/{id}/validate
   * canonical: OpenAPI #/components/schemas/ValidationResult
   *
   * 여기서는 예외를 던지지 않는다. 사용자가 무엇을 고쳐야 하는지
   * **한 화면에서 전부** 볼 수 있어야 하기 때문이다. (v1.1 §07 Error Summary)
   */
  async validate(
    cycleId: string,
    admissionTypeCode: string,
    fields: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const { schemaVersion, schema } = await this.load(cycleId, admissionTypeCode);
    return this.runValidation(
      `${cycleId}::${admissionTypeCode}::full`,
      schemaVersion,
      schema,
      fields,
    );
  }

  private runValidation(
    cacheKey: string,
    version: string,
    schema: Record<string, unknown>,
    data: Record<string, unknown>,
  ): ValidationResult {
    const fn = this.compile(cacheKey, version, schema);
    const ok = fn(data);
    if (ok) return { valid: true, issues: [] };

    return {
      valid: false,
      issues: (fn.errors ?? []).map((e) => toIssue(e, schema)),
    };
  }

  /** Config 버전이 바뀌면 캐시를 자동으로 버린다. */
  private compile(
    cacheKey: string,
    version: string,
    schema: Record<string, unknown>,
  ): ValidateFunction {
    const cached = this.compiled.get(cacheKey);
    if (cached && cached.version === version) return cached.fn;

    try {
      const fn = this.ajv.compile(schema);
      this.compiled.set(cacheKey, { version, fn });
      return fn;
    } catch (err) {
      // 잘못된 스키마가 Config 에 들어간 상황. 운영자 설정 오류다. (v1.1 §A14)
      this.logger.error(
        `form schema compile failed: ${cacheKey} v${version} ${(err as Error).message}`,
      );
      throw ProblemException.retryable('전형 양식 설정에 문제가 있어 처리할 수 없습니다.');
    }
  }

}

/**
 * 검증기 오류를 지원자가 읽을 문장으로. (T-M5-52, U-1)
 *
 * 전에는 Ajv 의 영문 원문과 항목 코드가 그대로 나갔다 — `highSchool — must have required property 'highSchool'`.
 * 항목 이름은 양식의 `title` 에서 온다(설정 검사가 title 없는 항목을 거절한다, U-29).
 * 응답 모양(path·code·message)은 그대로다 — path 는 화면이 그 칸을 찾는 데 쓴다.
 */
export function toIssue(e: ErrorObject, schema: Record<string, unknown>): ValidationIssue {
  const missing = e.keyword === 'required' ? String(e.params?.['missingProperty'] ?? '') : '';
  const path = e.instancePath || (missing ? `/${missing}` : '');
  const field = path.split('/')[1] ?? '';
  const prop = ((schema.properties ?? {}) as Record<string, Record<string, unknown>>)[field] ?? {};
  const name = typeof prop.title === 'string' && prop.title.trim() ? prop.title : '이 항목';
  const p = e.params as Record<string, unknown>;
  const formatHint = typeof prop.description === 'string' && prop.description ? ` (${prop.description})` : '';

  let message: string;
  switch (e.keyword) {
    case 'required':
      message = `${josa(name, '을/를')} 입력해 주십시오.`;
      break;
    case 'maxLength':
      message = `${josa(name, '은/는')} ${p.limit}자 이하로 입력해 주십시오.`;
      break;
    case 'minLength':
      message = `${josa(name, '은/는')} ${p.limit}자 이상 입력해 주십시오.`;
      break;
    case 'maximum':
    case 'exclusiveMaximum':
      message = `${josa(name, '은/는')} ${p.limit} ${e.keyword === 'maximum' ? '이하' : '미만'}로 입력해 주십시오.`;
      break;
    case 'minimum':
    case 'exclusiveMinimum':
      message = `${josa(name, '은/는')} ${p.limit} ${e.keyword === 'minimum' ? '이상' : '초과'}로 입력해 주십시오.`;
      break;
    case 'type':
      message =
        p.type === 'integer'
          ? `${name}에는 정수를 입력해 주십시오.`
          : p.type === 'number'
            ? `${name}에는 숫자를 입력해 주십시오.`
            : `${name} 값의 형식이 올바르지 않습니다.`;
      break;
    case 'format':
      message =
        p.format === 'email'
          ? `${name} 형식이 올바르지 않습니다. 예: name@example.com`
          : `${name} 형식이 올바르지 않습니다.${formatHint}`;
      break;
    case 'pattern':
      // 정규식은 보이지 않는다. 형식 안내는 양식의 description 이 사람 말로 갖는다.
      message = `${name} 형식이 올바르지 않습니다.${formatHint}`;
      break;
    case 'enum':
      message = `${josa(name, '은/는')} 주어진 선택지 가운데에서 골라 주십시오.`;
      break;
    case 'additionalProperties':
      message = '이 전형 양식에 없는 항목이 들어 있습니다. 화면을 새로고침한 뒤 다시 저장해 주십시오.';
      break;
    default:
      message = `${name} 값이 올바르지 않습니다.`;
  }
  return { code: (e.keyword ?? 'invalid').toUpperCase(), path, message };
}

/** 작성 도중에는 충족될 수 없는 제약을 걷어낸다. 최종검증에서는 그대로 본다. */
function relaxForPartialInput(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const relaxed: Record<string, unknown> = {};

  for (const [code, prop] of Object.entries(properties)) {
    const { minLength, minimum, pattern, format, ...keep } = prop;
    // 참조만 하고 버린다. lint 가 미사용 변수를 잡지 않도록 void 처리한다.
    void minLength;
    void minimum;
    void pattern;
    void format;
    relaxed[code] = keep;
  }

  return { ...schema, required: [], properties: relaxed };
}
