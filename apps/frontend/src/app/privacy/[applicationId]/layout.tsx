import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '개인정보 열람·정정·삭제 요청' };

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return children;
}
