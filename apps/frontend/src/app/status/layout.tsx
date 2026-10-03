import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '서비스 상태' };

export default function StatusLayout({ children }: { children: ReactNode }) {
  return children;
}
