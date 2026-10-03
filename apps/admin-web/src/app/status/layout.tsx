import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '장애 공지' };

export default function StatusLayout({ children }: { children: ReactNode }) {
  return children;
}
