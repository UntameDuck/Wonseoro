'use client';

import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { Icon, type IconName } from './icon';

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
  id,
  describedBy,
  children,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
  fullWidth,
}: {
  /** 화면이 동작 뒤 포커스를 돌려줄 때 쓰는 id (T-M5-40) */
  id?: string;
  /** 스크린리더가 버튼 이름 뒤에 읽을 설명의 id 들 — 같은 이름의 버튼이 여럿일 때 무엇의 버튼인지 (T-M5-42) */
  describedBy?: string;
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
      id={id}
      aria-describedby={describedBy}
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
  /** 오류 요약이 이 칸으로 데려갈 때 쓰는 고정 id. 없으면 자동으로 만든다. */
  id?: string;
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
  id: fixedId,
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
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  // 스크린리더는 칸에서 안내·오류·글자 수를 설명으로 읽는다 (T-M5-42)
  const describedBy = [hint ? hintId : null, error ? errorId : null, maxLength ? countId : null]
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
        {/* 별표는 눈으로 보는 표시다. 스크린리더는 칸의 required 로 "필수" 를 읽는다 — 이름에 별표·"필수 입력" 을
            넣으면 "출신 고등학교 별표 필수 입력, 필수" 로 두 번 읽는다 (T-M5-42) */}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--krds-danger)', marginLeft: 4 }}>
            *
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
          id={countId}
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
          <Icon name="cross" />
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
  id: fixedId,
  label,
  value,
  options,
  onChange,
  hint,
  error,
  required,
  disabled,
}: {
  /** 오류 요약이 이 칸으로 데려갈 때 쓰는 고정 id */
  id?: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (v: string) => void;
  hint?: string;
  /** 칸 옆 오류 — 오류 요약과 동시에 (Field 와 같다) */
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

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
        {/* 별표는 눈으로 보는 표시다. 스크린리더는 칸의 required 로 "필수" 를 읽는다 — 이름에 별표·"필수 입력" 을
            넣으면 "출신 고등학교 별표 필수 입력, 필수" 로 두 번 읽는다 (T-M5-42) */}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--krds-danger)', marginLeft: 4 }}>
            *
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
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
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
      {error && (
        <p id={errorId} style={{ margin: 'var(--krds-space-2) 0 0', color: 'var(--krds-danger)', fontSize: 'var(--krds-text-sm)', fontWeight: 700 }}>
          <Icon name="cross" />
          {error}
        </p>
      )}
    </div>
  );
}

/** 검증 경로(`/highSchool`)의 첫 항목 코드. 칸 id 는 `field-<코드>` 다. 경로가 없으면 칸에 매이지 않은 오류다. */
export function fieldOf(path: string): string {
  return path.replace(/^\//, '').split('/')[0] ?? '';
}

export function ErrorSummary({
  issues,
  onSelect,
}: {
  issues: Array<{ path: string; message: string }>;
  /**
   * 항목을 누르면 그 칸으로 간다. 칸이 다른 단계에 있으면 화면이 단계를 옮긴 뒤 포커스한다.
   * 없으면 같은 화면의 `field-<코드>` 칸에 포커스한다.
   * 문장은 서버가 항목 이름으로 시작해 만든다 — 항목 코드를 앞에 붙이지 않는다. (T-M5-52, U-1)
   */
  onSelect?: (path: string) => void;
}) {
  if (issues.length === 0) return null;
  return <ErrorSummaryBox issues={issues} {...(onSelect ? { onSelect } : {})} />;
}

/**
 * 요약이 나타나면 포커스를 받는다 — 키보드·스크린리더 사용자는 누른 버튼 자리에 남아 있어 무엇이 틀렸는지
 * 모른다. 요약에서 Tab 하면 첫 항목 링크다 (T-M5-40). 칸을 고쳐 항목이 줄어도 다시 포커스하지 않는다 —
 * 입력 중인 칸에서 포커스를 빼앗지 않는다. 새 검증 결과로 다시 받게 하려면 화면이 key 를 바꾼다.
 */
function ErrorSummaryBox({
  issues,
  onSelect,
}: {
  issues: Array<{ path: string; message: string }>;
  onSelect?: (path: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      aria-labelledby="error-summary-title"
      style={{
        marginBottom: 'var(--krds-space-5)',
        padding: 'var(--krds-space-4)',
        background: 'var(--krds-danger-weak)',
        border: '2px solid var(--krds-danger)',
        borderRadius: 'var(--krds-radius)',
      }}
    >
      <h2
        id="error-summary-title"
        style={{
          margin: '0 0 var(--krds-space-2)',
          fontSize: 'var(--krds-text-lg)',
          color: 'var(--krds-danger)',
        }}
      >
        <Icon name="cross" />
        입력을 확인해 주십시오 ({issues.length}건)
      </h2>
      <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
        {issues.map((i) => {
          const field = fieldOf(i.path);
          return (
            <li key={`${i.path}-${i.message}`} style={{ fontSize: 'var(--krds-text-sm)' }}>
              {field ? (
                <a
                  href={`#field-${field}`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (onSelect) onSelect(i.path);
                    // 주소 조각(#)으로 옮기면 화면만 움직이고 포커스는 그대로다 — 칸에 직접 포커스한다
                    else document.getElementById(`field-${field}`)?.focus();
                  }}
                  style={{ color: 'var(--krds-danger)', fontWeight: 700 }}
                >
                  {i.message}
                </a>
              ) : (
                i.message
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

export function Alert({
  tone = 'info',
  title,
  children,
  focusKey,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  children?: ReactNode;
  /**
   * 동작의 결과를 알리는 안내면 값을 준다 — 값이 바뀔 때마다(새 결과마다) 이 안내로 포커스를 옮긴다 (T-M5-41).
   * 승인·적용·검사 뒤 누른 버튼이 비활성으로 바뀌거나 사라지면 포커스가 문서 처음으로 떨어진다.
   * 결과를 읽은 자리에서 Tab 하면 다음 할 일로 간다. 조회 결과처럼 사람이 누르지 않은 안내에는 주지 않는다.
   */
  focusKey?: unknown;
}) {
  // 알림 영역(role)은 위험(오류)과 포커스를 받는 결과 안내에만 둔다. 화면에 늘 있는 안내 상자까지 알림 영역이면
  // 단계를 옮길 때마다 스크린리더가 안내문을 덩달아 읽는다. 나중에 나타나 알려야 하는 안내는 LiveRegion 안에 둔다 (T-M5-42)
  const ref = useRef<HTMLDivElement>(null);
  const focusable = focusKey !== undefined;
  useEffect(() => {
    if (focusable) ref.current?.focus();
  }, [focusable, focusKey]);
  const palette = (
    {
      info: ['var(--krds-primary)', 'var(--krds-primary-weak)', 'info'],
      warning: ['var(--krds-warning)', 'var(--krds-warning-weak)', 'warning'],
      danger: ['var(--krds-danger)', 'var(--krds-danger-weak)', 'cross'],
      success: ['var(--krds-success)', 'var(--krds-success-weak)', 'check'],
    } as const
  )[tone];

  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : focusable ? 'status' : undefined}
      {...(focusable ? { tabIndex: -1 } : {})}
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
        <Icon name={palette[2] as IconName} />
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

/**
 * 늘 그려 두는 알림 영역 — 안의 글이 바뀌면 스크린리더가 읽는다 (T-M5-42, KWCAG 상태 메시지).
 * 알림 영역은 알릴 글보다 **먼저** 문서에 있어야 한다. 글과 함께 새로 생긴 알림 영역은 스크린리더가 놓치기 쉽다.
 * 그래서 나타났다 사라지는 안내(오래 걸리는 요청·업로드 진행·운영 배너)는 이 영역 안에서 바꾼다.
 */
export function LiveRegion({ children, assertive }: { children?: ReactNode; assertive?: boolean }) {
  return (
    <div role={assertive ? 'alert' : 'status'} aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true">
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

export function Card({
  title,
  titleId,
  titleLevel = 2,
  children,
}: {
  title?: string;
  /**
   * 제목에 id 를 주면 화면이 단계·상태를 바꾼 뒤 이 제목으로 포커스를 옮길 수 있다 (T-M5-40).
   * 누른 버튼이 사라지는 화면 전환에서 포커스가 문서 처음으로 떨어지지 않게 한다.
   */
  titleId?: string;
  /** 화면의 큰 제목이 이 카드 제목이면 1 — 화면마다 큰 제목(h1)은 하나다 (T-M5-42). 모양은 같다 */
  titleLevel?: 1 | 2;
  children: ReactNode;
}) {
  const Heading = titleLevel === 1 ? 'h1' : 'h2';
  return (
    <section
      {...(titleId && title ? { 'aria-labelledby': titleId } : {})}
      style={{
        background: 'var(--krds-bg)',
        border: '1px solid var(--krds-border)',
        borderRadius: 'var(--krds-radius-lg)',
        padding: 'var(--krds-space-5)',
        marginBottom: 'var(--krds-space-5)',
      }}
    >
      {title && (
        <Heading
          {...(titleId ? { id: titleId, tabIndex: -1 } : {})}
          style={{ margin: '0 0 var(--krds-space-4)', fontSize: 'var(--krds-text-xl)' }}
        >
          {title}
        </Heading>
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
