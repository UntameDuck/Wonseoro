import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** 화면 제목 (T-M5-55, KWCAG 2.4.2) — 단계 이름은 화면이 앞에 붙인다 */
export const metadata: Metadata = { title: '원서 작성' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
