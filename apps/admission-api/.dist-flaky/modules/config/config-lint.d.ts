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
/**
 * @param typeCodes 이 모집 주기의 전형 코드. 모르면 null — 그때는 전형 코드 대조를 건너뛴다.
 */
export declare function lintConfig(config: unknown, typeCodes: readonly string[] | null): ConfigLintResult;
