'use client';

import { Field } from '@wonseoro/krds';

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
  'x-multiline'?: boolean;
}

/** 스키마에 title 이 없을 때 쓰는 한글 라벨. 없으면 코드를 그대로 보여준다. */
const FALLBACK_LABELS: Record<string, string> = {
  highSchool: '출신 고등학교',
  graduationYear: '졸업(예정) 연도',
  selfIntro: '자기소개',
  gpa: '내신 성적',
  contactEmail: '이메일',
  csatNumber: '수능 수험번호',
};

export function SchemaForm({
  schema,
  values,
  onChange,
  /** 이 단계에서 보여줄 필드만 고른다. 비우면 전부 보여준다. */
  only,
  errors,
}: {
  schema: JsonSchema | null;
  values: Record<string, string>;
  onChange: (code: string, value: string) => void;
  only?: string[];
  errors?: Record<string, string>;
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

  return (
    <>
      {codes.map((code) => {
        const p = schema.properties![code]!;
        const isNumber = p.type === 'integer' || p.type === 'number';

        return (
          <Field
            key={code}
            label={p.title ?? FALLBACK_LABELS[code] ?? code}
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
