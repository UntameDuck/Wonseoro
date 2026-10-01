import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** 화면 제목 (T-M5-55, KWCAG 2.4.2) */
export const metadata: Metadata = { title: '증적 조회' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
