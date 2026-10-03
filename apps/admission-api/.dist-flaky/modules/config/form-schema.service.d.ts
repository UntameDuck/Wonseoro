import { ErrorObject } from 'ajv';
import { Db } from '@wonseoro/server-kit';
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
}
/**
 * `x-profile` 표시가 하나도 없는 옛 설정(표시를 도입하기 전에 승인된 것)을 위한 기본값.
 * 스키마에 실제로 있는 속성만 남긴다 — 없는 항목을 Vault 에 요청하지 않는다.
 * 새 설정은 표시를 달고, 설정 검사(config-lint)가 표시 없는 설정에 경고를 준다.
 */
export declare const LEGACY_PROFILE_FIELDS: readonly ["highSchool", "graduationYear", "contactEmail"];
/** 스키마에서 공통원서 항목을 고른다. */
export declare function profileFieldsOf(schema: Record<string, unknown>): string[];
/** 설정에서 전형의 서류 목록을 만든다. 필수가 먼저, 같은 서류가 둘 다 있으면 필수로 본다. */
export declare function documentsOf(config: ConfigJson | undefined, admissionTypeCode: string): DocumentSpec[];
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
export declare class FormSchemaService {
    private readonly db;
    private readonly logger;
    private readonly ajv;
    /** cycleId::admissionTypeCode → 컴파일된 검증기. 컴파일은 비싸므로 캐시한다. */
    private readonly compiled;
    constructor(db: Db);
    /**
     * 활성 Config 에서 해당 전형의 추가문항 스키마를 가져온다.
     * 스키마가 없으면 추가문항이 없는 전형으로 취급한다 (빈 스키마).
     */
    load(cycleId: string, admissionTypeCode: string): Promise<FormSchema>;
    /**
     * 자동저장용 검증.
     * required 는 보지 않는다. 대신 스키마에 없는 필드는 거부한다.
     * 모르는 필드를 받아두면 나중에 최종검증에서 원인을 찾기 어려워진다.
     */
    assertKnownFields(cycleId: string, admissionTypeCode: string, fields: Record<string, unknown>): Promise<string>;
    /**
     * 최종 검증. POST /api/v1/applications/{id}/validate
     * canonical: OpenAPI #/components/schemas/ValidationResult
     *
     * 여기서는 예외를 던지지 않는다. 사용자가 무엇을 고쳐야 하는지
     * **한 화면에서 전부** 볼 수 있어야 하기 때문이다. (v1.1 §07 Error Summary)
     */
    validate(cycleId: string, admissionTypeCode: string, fields: Record<string, unknown>): Promise<ValidationResult>;
    private runValidation;
    /** Config 버전이 바뀌면 캐시를 자동으로 버린다. */
    private compile;
}
/**
 * 검증기 오류를 지원자가 읽을 문장으로. (T-M5-52, U-1)
 *
 * 전에는 Ajv 의 영문 원문과 항목 코드가 그대로 나갔다 — `highSchool — must have required property 'highSchool'`.
 * 항목 이름은 양식의 `title` 에서 온다(설정 검사가 title 없는 항목을 거절한다, U-29).
 * 응답 모양(path·code·message)은 그대로다 — path 는 화면이 그 칸을 찾는 데 쓴다.
 */
export declare function toIssue(e: ErrorObject, schema: Record<string, unknown>): ValidationIssue;
export {};
