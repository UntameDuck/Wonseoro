'use client';

import type { ConsentState } from '../lib/api';

/**
 * 원서 동의 — 1단계 맨 위 (보호법 제15·22조, 문서 10 G-2·G-11, D-81).
 *
 * 동의마다 전문을 보이고 체크로 받는다. 전문은 길어서 높이를 정한 영역에 두되 키보드로 스크롤할 수 있게
 * 포커스를 받는다(tabIndex) — 마우스 없이 끝까지 읽을 수 있어야 한다. 체크 id 는 `consent-<코드>` —
 * 오류 요약의 "…에 동의해 주십시오" 링크가 여기로 데려온다. 오류는 체크 옆에도 같은 문장으로 둔다.
 */
export function ConsentPanel({
  consents,
  errors,
  disabled,
  onChange,
  heading = '개인정보 수집·이용 동의',
  intro = '필수 동의를 하지 않으면 원서를 접수할 수 없습니다. 전문을 읽고 동의해 주십시오.',
  headingId = 'consent-title',
}: {
  consents: ConsentState[];
  /** 코드 → 오류 문장 */
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (code: string, granted: boolean) => void;
  /** 민감정보 서류의 별도 동의(4단계, D-85)는 제목·안내가 다르다. 한 화면에 여럿이면 제목 id 도 다르게 */
  heading?: string;
  intro?: string;
  headingId?: string;
}) {
  if (consents.length === 0) return null;
  return (
    <section aria-labelledby={headingId} style={{ marginBottom: 'var(--krds-space-5)' }}>
      <h3 id={headingId} style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-lg)' }}>
        {heading}
      </h3>
      <p style={{ margin: '0 0 var(--krds-space-3)', fontSize: 'var(--krds-text-sm)', color: 'var(--krds-fg-muted)' }}>
        {intro}
      </p>
      {consents.map((c) => {
        const id = `consent-${c.code}`;
        const error = errors[c.code];
        return (
          <div key={c.code} style={{ marginBottom: 'var(--krds-space-4)' }}>
            <h4 style={{ margin: '0 0 var(--krds-space-2)', fontSize: 'var(--krds-text-base)' }}>{c.title}</h4>
            <div
              role="region"
              aria-label={`${c.title} 전문`}
              tabIndex={0}
              style={{
                maxHeight: '12rem',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                padding: 'var(--krds-space-3)',
                border: '1px solid var(--krds-border)',
                borderRadius: 'var(--krds-radius)',
                background: 'var(--krds-bg)',
                fontSize: 'var(--krds-text-sm)',
              }}
            >
              {c.text}
            </div>
            <label
              htmlFor={id}
              style={{ display: 'flex', gap: 'var(--krds-space-2)', alignItems: 'flex-start', marginTop: 'var(--krds-space-2)' }}
            >
              <input
                id={id}
                type="checkbox"
                checked={c.granted}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => onChange(c.code, e.target.checked)}
                style={{ width: 24, height: 24, marginTop: 0 }}
              />
              <span>위 내용에 동의합니다{c.required ? ' (필수)' : ' (선택)'}</span>
            </label>
            {error && (
              <p id={`${id}-error`} style={{ margin: 'var(--krds-space-1) 0 0', color: 'var(--krds-danger)', fontSize: 'var(--krds-text-sm)' }}>
                {error}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
