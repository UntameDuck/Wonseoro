'use client';

import { DescriptionList, Field, Select } from '@wonseoro/krds';

/**
 * JSON Schema 기반 동적 폼 — 기술설계서 v1.1 §A5
 *
 * **대학이 늘어나도 이 파일을 고치지 않는다.**
 * 전형이 추가되면 Config 의 JSON Schema 만 바뀌고 화면은 그대로다.
 * 필드를 하드코딩하면 §A5 의 "code fork 0" 이 UI 에서 깨진다. (불일치 대장 D-19)
 *
 * 지원하는 스키마 어휘 (서버 ajv 와 맞춘다)
 *   type: string | integer | number
 *   minLength / maxLength / pattern / format: email
 *   minimum / maximum
 *   enum        → 선택 목록
 *   required    → 필수 표시
 *   title       → 라벨. 없으면 필드 코드를 쓴다
 *   description → 수집목적 안내. §07 이 요구한다
 *   x-multiline → 긴 글 입력
 */

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  enum?: string[];
  /** 선택지마다 보일 이름. 없으면 값을 그대로 쓴다 */
  'x-enumTitles'?: string[];
  'x-multiline'?: boolean;
}


export function SchemaForm({
  schema,
  values,
  onChange,
  /** 이 단계에서 보여줄 필드만 고른다. 비우면 전부 보여준다. */
  only,
  errors,
  readOnly,
}: {
  schema: JsonSchema | null;
  values: Record<string, string>;
  onChange: (code: string, value: string) => void;
  only?: string[];
  errors?: Record<string, string>;
  /**
   * 결제를 시작했거나 접수·취소된 원서. 입력칸 대신 값을 보여 준다 — 입력칸을 두면 고쳐도
   * 저장되지 않는 칸이 된다(서버가 거절한다). (D-55)
   */
  readOnly?: boolean;
}) {
  if (!schema?.properties) {
    return (
      <p role="status" style={{ color: 'var(--krds-fg-muted)' }}>
        입력 항목을 불러오는 중입니다…
      </p>
    );
  }

  const required = new Set(schema.required ?? []);
  const codes = Object.keys(schema.properties).filter((c) => !only || only.includes(c));

  if (codes.length === 0) {
    return (
      <p style={{ color: 'var(--krds-fg-muted)' }}>이 단계에서 입력할 항목이 없습니다.</p>
    );
  }

  // 라벨은 스키마의 title 에서만 온다. 없으면 코드를 그대로 보인다 — 설정 검사(config-lint)가
  // title 없는 항목을 경고한다. 전에는 화면에 라벨 사전을 박아 두어 새 전형 항목만 코드로 보였다.
  const labelOf = (code: string) => schema.properties![code]!.title ?? code;

  if (readOnly) {
    return (
      <DescriptionList
        items={codes.map((code) => [labelOf(code), values[code] ? choiceLabel(schema.properties![code]!, values[code]!) : '입력하지 않음'])}
      />
    );
  }

  return (
    <>
      {codes.map((code) => {
        const p = schema.properties![code]!;
        const isNumber = p.type === 'integer' || p.type === 'number';

        // 선택지가 정해진 항목은 선택 목록으로 — 전에는 자유 입력칸이라 정해진 값 밖을 써도 저장 뒤에야 거절됐다 (U-30)
        if (p.enum && p.enum.length > 0) {
          return (
            <Select
              key={code}
              id={`field-${code}`}
              label={labelOf(code)}
              value={values[code] ?? ''}
              onChange={(v) => onChange(code, v)}
              options={[
                { value: '', label: '선택하십시오' },
                ...p.enum.map((v) => ({ value: v, label: choiceLabel(p, v) })),
              ]}
              {...(p.description ? { hint: p.description } : {})}
              {...(errors?.[code] ? { error: errors[code] } : {})}
              required={required.has(code)}
            />
          );
        }

        return (
          <Field
            key={code}
            id={`field-${code}`}
            label={labelOf(code)}
            value={values[code] ?? ''}
            onChange={(v) => onChange(code, v)}
            hint={p.description ?? describe(p)}
            required={required.has(code)}
            type={isNumber ? 'number' : p.format === 'email' ? 'email' : 'text'}
            {...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {})}
            {...(p['x-multiline'] || (p.maxLength ?? 0) > 200 ? { multiline: true } : {})}
            {...(errors?.[code] ? { error: errors[code] } : {})}
          />
        );
      })}
    </>
  );
}

/** 선택지 값의 이름 — x-enumTitles 가 있으면 그것, 없으면 값 그대로 */
function choiceLabel(p: JsonSchemaProperty, value: string): string {
  const i = p.enum?.indexOf(value) ?? -1;
  return i >= 0 ? (p['x-enumTitles']?.[i] ?? value) : value;
}

/**
 * 스키마 제약을 사람이 읽는 안내문으로 바꾼다.
 * description 이 없어도 사용자가 무엇을 입력해야 하는지 알 수 있어야 한다. (§07)
 *
 * pattern(정규식)은 그대로 보여주지 않는다. 사용자가 읽을 수 있는 말이 아니다.
 * 형식 제약이 있으면 description 에 사람 말로 적는 것이 Config 작성자의 책임이다.
 */
function describe(p: JsonSchemaProperty): string | undefined {
  const parts: string[] = [];

  if (p.minLength !== undefined && p.maxLength !== undefined) {
    parts.push(`${p.minLength}~${p.maxLength}자`);
  } else if (p.minLength !== undefined) {
    parts.push(`${p.minLength}자 이상`);
  } else if (p.maxLength !== undefined) {
    parts.push(`${p.maxLength}자 이하`);
  }

  if (p.minimum !== undefined && p.maximum !== undefined) {
    parts.push(`${p.minimum} 이상 ${p.maximum} 이하`);
  } else if (p.minimum !== undefined) {
    parts.push(`${p.minimum} 이상`);
  } else if (p.maximum !== undefined) {
    parts.push(`${p.maximum} 이하`);
  }

  if (p.format === 'email') parts.push('이메일 형식');

  return parts.length > 0 ? parts.join(' · ') : undefined;
}
