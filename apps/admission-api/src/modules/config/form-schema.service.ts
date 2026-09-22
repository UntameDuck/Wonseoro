import { Injectable, Logger } from '@nestjs/common';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { Db } from '@wonseoro/server-kit';
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

export interface FormSchema {
  /** config_version.version — application_field_value.schema_version 에 그대로 저장한다. */
  schemaVersion: string;
  /** 대학별 추가문항 JSON Schema. */
  schema: Record<string, unknown>;
}

interface ConfigRow extends Record<string, unknown> {
  version: string;
  config_json: { forms?: Record<string, Record<string, unknown>> };
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
      return { schemaVersion: 'none', schema: { type: 'object', properties: {} } };
    }

    const schema = row.config_json?.forms?.[admissionTypeCode] ?? {
      type: 'object',
      properties: {},
    };
    return { schemaVersion: row.version, schema };
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

    // 스키마가 비어 있으면(활성 Config 없음) 통과시킨다. M1 개발 편의.
    if (known.size === 0) return schemaVersion;

    const unknown = Object.keys(fields).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      throw ProblemException.validationFailed(
        `이 전형에 없는 항목입니다: ${unknown.join(', ')}`,
      );
    }

    // 값 타입은 부분 저장이어도 확인한다. required 만 건너뛴다.
    const partial = { ...schema, required: [] as string[] };
    const result = this.runValidation(
      `${cycleId}::${admissionTypeCode}::partial`,
      schemaVersion,
      partial,
      fields,
    );
    if (!result.valid) {
      throw ProblemException.validationFailed(
        result.issues.map((i) => `${i.path} ${i.message}`).join('; '),
      );
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
      issues: (fn.errors ?? []).map((e) => this.toIssue(e)),
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

  private toIssue(e: ErrorObject): ValidationIssue {
    const path = e.instancePath || `/${String(e.params?.['missingProperty'] ?? '')}`;
    return {
      code: (e.keyword ?? 'invalid').toUpperCase(),
      path,
      message: e.message ?? '값이 올바르지 않습니다',
    };
  }
}
