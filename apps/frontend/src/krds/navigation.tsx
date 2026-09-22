'use client';

import Link from 'next/link';

/**
 * 지원자 흐름 6단계 — 기술설계서 v1.1 §07 (canonical)
 *
 * PDF 는 5단계, v1.0 §12.1 은 10항목으로 적혀 있으나
 * KRDS 단계 표시기 권장 범위에 맞춘 v1.1 §07 의 6단계를 따른다. (불일치 대장 D-2)
 */
export const STEPS = [
  { no: 1, slug: '01-common', label: '공통정보' },
  { no: 2, slug: '02-university', label: '대학·전형' },
  { no: 3, slug: '03-additional', label: '추가정보' },
  { no: 4, slug: '04-documents', label: '서류' },
  { no: 5, slug: '05-review', label: '검토·결제' },
  { no: 6, slug: '06-submit', label: '최종제출' },
] as const;

export type StepNo = (typeof STEPS)[number]['no'];

/**
 * Step Indicator.
 * 현재 위치를 **색만으로** 표시하지 않는다. 숫자와 "현재 단계" 텍스트를 함께 준다.
 */
export function StepIndicator({ current }: { current: StepNo }) {
  return (
    <nav aria-label="원서접수 진행 단계" style={{ marginBottom: 'var(--krds-space-5)' }}>
      <ol
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--krds-space-2)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {STEPS.map((s) => {
          const state = s.no < current ? 'done' : s.no === current ? 'current' : 'todo';
          return (
            <li
              key={s.no}
              aria-current={state === 'current' ? 'step' : undefined}
              style={{
                flex: '1 1 96px',
                minWidth: 96,
                padding: 'var(--krds-space-2) var(--krds-space-3)',
                borderRadius: 'var(--krds-radius)',
                background:
                  state === 'current'
                    ? 'var(--krds-primary)'
                    : state === 'done'
                      ? 'var(--krds-primary-weak)'
                      : 'var(--krds-bg)',
                color: state === 'current' ? '#fff' : 'var(--krds-fg)',
                border: `1px solid ${
                  state === 'todo' ? 'var(--krds-border)' : 'var(--krds-primary)'
                }`,
                fontSize: 'var(--krds-text-sm)',
                fontWeight: state === 'current' ? 700 : 400,
              }}
            >
              <span aria-hidden="true">{state === 'done' ? '✓ ' : `${s.no}. `}</span>
              {s.label}
              {state === 'current' && <span className="krds-sr-only"> (현재 단계)</span>}
              {state === 'done' && <span className="krds-sr-only"> (완료)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Breadcrumb({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="현재 위치" style={{ marginBottom: 'var(--krds-space-4)' }}>
      <ol
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--krds-space-2)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          fontSize: 'var(--krds-text-sm)',
          color: 'var(--krds-fg-muted)',
        }}
      >
        {trail.map((t, i) => (
          <li key={t.label} style={{ display: 'flex', gap: 'var(--krds-space-2)' }}>
            {i > 0 && <span aria-hidden="true">›</span>}
            {t.href ? (
              <Link href={t.href} style={{ color: 'var(--krds-primary)' }}>
                {t.label}
              </Link>
            ) : (
              <span aria-current="page">{t.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
