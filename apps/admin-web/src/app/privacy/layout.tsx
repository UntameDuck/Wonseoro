import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '권리 요청' };

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return children;
}
