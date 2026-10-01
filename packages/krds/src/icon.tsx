/**
 * 상태 아이콘 — 이모지·유니코드 기호 대신 SVG. (T-M5-54, U-16)
 *
 * 전에는 ✓ ✕ ⚠ ℹ ⟳ 🕐 ○ 를 글자로 넣었다. 글꼴·OS 마다 모양이 달랐고(🕐 은 Windows 에서 색 이모지),
 * 일부 글꼴에는 ⟳ 이 없어 네모로 보였다. 모양은 그 기호와 같게 그리고 색은 글자색을 따른다.
 *
 * 아이콘은 언제나 글과 함께 쓰고 스크린리더에는 숨긴다(aria-hidden) — 색·모양만으로 상태를 말하지 않는다(KRDS 원칙).
 */
import type { ReactElement } from 'react';

export type IconName = 'check' | 'cross' | 'warning' | 'info' | 'clock' | 'sync' | 'circle';

const PATHS: Record<IconName, ReactElement> = {
  check: <polyline points="3.5,8.5 6.5,11.5 12.5,4.5" />,
  cross: (
    <>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2 L14.5 13.5 H1.5 Z" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <line x1="8" y1="11.5" x2="8" y2="11.6" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7" x2="8" y2="11.5" />
      <line x1="8" y1="4.6" x2="8" y2="4.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <polyline points="8,4.5 8,8 10.5,9.5" />
    </>
  ),
  sync: (
    <>
      <path d="M13 8 A5 5 0 1 1 11.5 4.5" />
      <polyline points="12,1.5 12,5 8.5,5" />
    </>
  ),
  circle: <circle cx="8" cy="8" r="5.5" />,
};

export function Icon({ name, label }: { name: IconName; /** 아이콘만 단독으로 쓸 때의 이름 — 대개 비운다 */ label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.125em', marginRight: '0.3em', flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
