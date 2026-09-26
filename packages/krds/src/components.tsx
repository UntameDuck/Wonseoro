'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';

/**
 * KRDS Wrapper SDK — 기술설계서 v1.1 §07·§B15
 *
 * 화면은 이 컴포넌트만 쓴다. 원시 `<input>` 을 직접 쓰지 않는다.
 * 공식 KRDS 컴포넌트 킷을 배치하면 이 파일의 구현만 갈아끼운다.
 *
 * 여기에 박아둔 규칙은 대학이 바꿀 수 없다.
 *   - Label 을 Placeholder 로 대체하지 않는다
 *   - 오류는 필드 인접 + 상단 Summary 를 **동시에**
 *   - 색만으로 상태를 표현하지 않는다. 아이콘 + 텍스트 병행
 *   - 중요 결과를 Toast 로만 알리지 않는다
 */

/* ────────────────────────────────────────────────────────────────────── */

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
  fullWidth,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  fullWidth?: boolean;
}) {
  const bg =
    variant === 'primary'
      ? 'var(--krds-primary)'
      : variant === 'danger'
        ? 'var(--krds-danger)'
        : 'var(--krds-bg)';
  const fg = variant === 'secondary' ? 'var(--krds-fg)' : '#fff';
  const border = variant === 'secondary' ? '1px solid var(--krds-border-strong)' : 'none';

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 'var(--krds-tap-min)',
        padding: '0 var(--krds-space-5)',
        background: disabled ? 'var(--krds-bg-muted)' : bg,
        color: disabled ? 'var(--krds-fg-subtle)' : fg,
        border,
        borderRadius: 'var(--krds-radius)',
        fontSize: 'var(--krds-text-base)',
        fontWeight: 700,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : undefined,
      }}
    >
      {children}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

export interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** 무엇을 왜 받는지. §07 이 수집목적 명시를 요구한다. */
  hint?: string;
  error?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'number';
  maxLength?: number;
  multiline?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  type = 'text',
  maxLength,
  multiline,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const common = {
    id,
    value,
    required,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    style: {
      width: '100%',
      minHeight: 'var(--krds-tap-min)',
      padding: 'var(--krds-space-3)',
      fontSize: 'var(--krds-text-base)',
      fontFamily: 'inherit',
      color: 'var(--krds-fg)',
      background: 'var(--krds-bg)',
      border: `1px solid ${error ? 'var(--krds-danger)' : 'var(--krds-border-strong)'}`,
      borderRadius: 'var(--krds-radius)',
    },
  };

  return (
    <div style={{ marginBottom: 'var(--krds-space-5)' }}>
      {/* Label 을 Placeholder 로 대체하지 않는다. (v1.1 §07) */}
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 'var(--krds-space-2)',
          fontWeight: 700,
          fontSize: 'var(--krds-text-sm)',
        }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--krds-danger)', marginLeft: 4 }}>
            *<span className="krds-sr-only">필수 입력</span>
          </span>
        )}
      </label>

      {hint && (
        <p
          id={hintId}
          style={{
            margin: '0 0 var(--krds-space-2)',
            fontSize: 'var(--krds-text-sm)',
            color: 'var(--krds-fg-muted)',
          }}
        >
          {hint}
        </p>
      )}

      {multiline ? (
        <textarea {...common} rows={6} style={{ ...common.style, minHeight: 140 }} />
      ) : (
        <input {...common} type={type} />
      )}

      {maxLength && (
        <p
          style={{
            margin: 'var(--krds-space-1) 0 0',
            fontSize: 'var(--krds-text-xs)',
            color: 'var(--krds-fg-muted)',
            textAlign: 'right',
          }}
        >
          {value.length} / {maxLength}자
        </p>
      )}

      {/* 오류는 필드 바로 옆에도 붙인다. 상단 Summary 와 **동시에** 제공한다. */}
      {error && (
        <p
          id={errorId}
          style={{
            margin: 'var(--krds-space-2) 0 0',
            color: 'var(--krds-danger)',
            fontSize: 'var(--krds-text-sm)',
            fontWeight: 700,
          }}
        >
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 페이지 상단 오류 요약. (v1.1 §07)
 * 사용자가 무엇을 고쳐야 하는지 **한 화면에서 전부** 봐야 한다.
 * 백엔드 `/validate` 가 issues 를 모아서 주는 이유가 이것이다.
 */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 선택 입력. Field 와 같은 규칙을 따른다 — Label 은 항상 보이고,
 * 힌트는 label 과 controls 사이에 둔다. (KRDS 입력 패턴)
 */
export function Select({
  label,
  value,
  options,
  onChange,
  hint,
  required,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div style={{ marginBottom: 'var(--krds-space-5)' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 'var(--krds-space-2)',
          fontWeight: 700,
          fontSize: 'var(--krds-text-sm)',
        }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--krds-danger)', marginLeft: 4 }}>
            *<span className="krds-sr-only">필수 입력</span>
          </span>
        )}
      </label>

      {hint && (
        <p
          id={hintId}
          style={{
            margin: '0 0 var(--krds-space-2)',
            fontSize: 'var(--krds-text-sm)',
            color: 'var(--krds-fg-muted)',
          }}
        >
          {hint}
        </p>
      )}

      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          minHeight: 'var(--krds-tap-min)',
          padding: 'var(--krds-space-3)',
          fontSize: 'var(--krds-text-base)',
          fontFamily: 'inherit',
          color: 'var(--krds-fg)',
          background: 'var(--krds-bg)',
          border: '1px solid var(--krds-border-strong)',
          borderRadius: 'var(--krds-radius)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ErrorSummary({
  issues,
}: {
  issues: Array<{ path: string; message: string }>;
}) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      style={{
        marginBottom: 'var(--krds-space-5)',
        padding: 'var(--krds-space-4)',
        background: 'var(--krds-danger-weak)',
        border: '2px solid var(--krds-danger)',
        borderRadius: 'var(--krds-radius)',
      }}
    >
      <h2
        style={{
          margin: '0 0 var(--krds-space-2)',
          fontSize: 'var(--krds-text-lg)',
          color: 'var(--krds-danger)',
        }}
      >
        <span aria-hidden="true">✕ </span>
        입력을 확인해 주십시오 ({issues.length}건)
      </h2>
      <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
        {issues.map((i) => (
          <li key={`${i.path}-${i.message}`} style={{ fontSize: 'var(--krds-text-sm)' }}>
            <strong>{i.path.replace(/^\//, '') || '입력값'}</strong> — {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  children?: ReactNode;
}) {
  const palette = {
    info: ['var(--krds-primary)', 'var(--krds-primary-weak)', 'ℹ'],
    warning: ['var(--krds-warning)', 'var(--krds-warning-weak)', '⚠'],
    danger: ['var(--krds-danger)', 'var(--krds-danger-weak)', '✕'],
    success: ['var(--krds-success)', 'var(--krds-success-weak)', '✓'],
  }[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        margin: 'var(--krds-space-4) 0',
        padding: 'var(--krds-space-4)',
        background: palette[1],
        borderLeft: `4px solid ${palette[0]}`,
        borderRadius: 'var(--krds-radius)',
      }}
    >
      {/* 색만으로 구분하지 않는다. 아이콘 + 텍스트 병행. (v1.1 §07) */}
      <strong style={{ color: palette[0] }}>
        <span aria-hidden="true">{palette[2]} </span>
        {title}
      </strong>
      {children && (
        <div style={{ marginTop: 'var(--krds-space-2)', fontSize: 'var(--krds-text-sm)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--krds-bg)',
        border: '1px solid var(--krds-border)',
        borderRadius: 'var(--krds-radius-lg)',
        padding: 'var(--krds-space-5)',
        marginBottom: 'var(--krds-space-5)',
      }}
    >
      {title && (
        <h2 style={{ margin: '0 0 var(--krds-space-4)', fontSize: 'var(--krds-text-xl)' }}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function DescriptionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gap: 'var(--krds-space-3)' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 'var(--krds-space-4)', flexWrap: 'wrap' }}>
          <dt
            style={{
              minWidth: 120,
              fontWeight: 700,
              fontSize: 'var(--krds-text-sm)',
              color: 'var(--krds-fg-muted)',
            }}
          >
            {k}
          </dt>
          <dd style={{ margin: 0, flex: 1 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
